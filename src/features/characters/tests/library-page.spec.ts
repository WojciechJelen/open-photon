import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

import {
  accessCode,
  count,
  open,
  seededResult,
  storageStatePath,
} from "../../../../tests/e2e/session.ts";
import { characterSummarySchema } from "../contracts.ts";

/** No cookies: a visitor without the access code. */
const anonymous = { cookies: [], origins: [] };

const PNG = readFileSync("tests/fixtures/fake-output.png");

/** A PNG no other test uploaded (random bytes after `IEND`, which decoders ignore). */
function uniquePng(name = "photo.png") {
  return { buffer: Buffer.concat([PNG, randomBytes(16)]), mimeType: "image/png", name };
}

/** Uploads a new photo with consent through the API, titled `title`; the stored character. */
async function uploadThroughApi(request: APIRequestContext, title?: string) {
  const response = await request.post("/api/characters", {
    multipart: { consent: "true", image: uniquePng() },
  });

  expect(response.status()).toBe(201);

  const character = characterSummarySchema.parse(await response.json());

  if (title === undefined) {
    return character;
  }

  const renamed = await request.patch(`/api/characters/${character.id}`, { data: { title } });

  return characterSummarySchema.parse(await renamed.json());
}

/** The library's grid, and one character's card in it. */
const grid = (page: Page) => page.getByRole("list", { name: "Characters" });
const card = (page: Page, name: string) => grid(page).getByRole("article", { name, exact: true });

/** The names of the cards in the grid, in order. */
const cardNames = (page: Page) =>
  grid(page)
    .getByRole("article")
    .evaluateAll((articles) => articles.map((article) => article.getAttribute("aria-label")));

/** A name no other test uses. */
const unique = (prefix: string) => `${prefix} ${randomBytes(3).toString("hex")}`;

test("a photo uploaded with consent joins the library, newest first, and stays after a reload and in a new session", async ({
  browser,
  page,
}) => {
  const uploads = count("characters WHERE origin = 'upload'");

  await open(page, "/characters");
  await expect(page.getByText("Shared workspace")).toBeVisible();
  // No builder is composed in: no link to it.
  await expect(page.getByRole("link", { name: "Describe a character" })).toHaveCount(0);
  await expect(grid(page)).toBeVisible();

  const upload = page.getByRole("region", { name: "Add a photo" });

  await upload.getByLabel("Upload a photo").setInputFiles(uniquePng());
  await expect(upload.getByRole("img", { name: "The photo you picked" })).toBeVisible();

  const submit = upload.getByRole("button", { name: "Add to library" });

  // The likeness consent is required: without it, nothing can be sent.
  await expect(submit).toBeDisabled();
  await upload.getByRole("checkbox", { name: /likeness/ }).check();
  await submit.click();

  await expect(page).toHaveURL(/selected=/);

  const id = new URL(page.url()).searchParams.get("selected") ?? "";
  const added = grid(page).locator(`[data-character-id="${id}"]`);

  await expect(added).toHaveAttribute("aria-current", "true");
  await expect(added).toBeFocused();
  await expect(added.getByText("Uploaded", { exact: true })).toBeVisible();
  await expect(added.getByText(/^Uploaded \w/)).toBeVisible();
  expect(count("characters WHERE origin = 'upload'")).toBe(uploads + 1);
  expect(
    count(`characters WHERE id = '${id}' AND origin = 'upload' AND consent_at IS NOT NULL`),
  ).toBe(1);

  // Most recent first: the new photo leads the grid.
  await expect(grid(page).getByRole("article").first()).toHaveAttribute("data-character-id", id);

  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await expect(grid(page).getByRole("article").first()).toHaveAttribute("data-character-id", id);

  // Another browser with the access code finds it too: one shared workspace.
  const other = await browser.newContext({ storageState: storageStatePath() });
  const otherPage = await other.newPage();

  await open(otherPage, "/characters");
  await expect(grid(otherPage).locator(`[data-character-id="${id}"]`)).toBeVisible();
  await other.close();
});

test("an upload without consent, or of a file that is not an image, is refused and stores nothing; the form recovers", async ({
  page,
  request,
}) => {
  // The server refuses a photo without consent, whatever the page does.
  const refused = await request.post("/api/characters", {
    multipart: { image: uniquePng() },
  });

  expect(refused.status()).toBe(422);
  expect((await refused.json()).reason).toBe("consent_required");

  const characters = count("characters");

  await open(page, "/characters");

  const upload = page.getByRole("region", { name: "Add a photo" });

  // A text file named like a PNG: the server checks the content.
  await upload.getByLabel("Upload a photo").setInputFiles({
    buffer: Buffer.from("not a picture"),
    mimeType: "image/png",
    name: "notes.png",
  });
  await upload.getByRole("checkbox", { name: /likeness/ }).check();
  await upload.getByRole("button", { name: "Add to library" }).click();
  await expect(upload).toHaveAttribute("data-reason", "not_image");
  await expect(upload.getByRole("alert")).toContainText("Not an image");
  expect(count("characters")).toBe(characters);

  // Choose another: a real photo goes through.
  await upload.getByLabel("Upload a photo").setInputFiles(uniquePng());
  await expect(upload.getByRole("alert")).toHaveCount(0);
  await expect(upload.getByRole("button", { name: "Add to library" })).toBeDisabled();
  await upload.getByRole("checkbox", { name: /likeness/ }).check();
  await upload.getByRole("button", { name: "Add to library" }).click();
  await expect(page).toHaveURL(/selected=/);
  expect(count("characters")).toBe(characters + 1);
});

test("a character is renamed in a dialog, 1–80 characters, and keeps its name after a reload", async ({
  page,
  request,
}) => {
  const character = await uploadThroughApi(request);
  const name = unique("Stage name");

  await open(page, `/characters?selected=${character.id}`);

  const added = grid(page).locator(`[data-character-id="${character.id}"]`);

  await expect(added).toHaveAttribute("aria-label", "Untitled photo");
  await added.getByRole("button", { name: "Rename Untitled photo" }).click();

  const dialog = page.getByRole("dialog", { name: "Rename character" });
  const field = dialog.getByLabel("Name");
  const save = dialog.getByRole("button", { name: "Save name" });

  await field.fill("   ");
  await expect(save).toBeDisabled();
  await field.fill("x".repeat(81));
  await expect(save).toBeDisabled();
  await field.fill(`  ${name}  `);
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(card(page, name)).toBeVisible();

  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await expect(card(page, name)).toBeVisible();
  await expect(card(page, name).getByRole("heading")).toHaveText(name);

  // A sample keeps its title: no Rename.
  await expect(card(page, "Placeholder blue").getByRole("button", { name: /Rename/ })).toHaveCount(
    0,
  );
});

test("a favorite is marked with its star, the favorites filter shows only favorites, and both survive a reload", async ({
  page,
  request,
}) => {
  const name = unique("Favorite dancer");
  const other = unique("Not a favorite");

  await uploadThroughApi(request, other);
  await uploadThroughApi(request, name);
  await open(page, "/characters");

  const star = card(page, name).getByRole("button", { name: `Add ${name} to favorites` });

  await star.click();
  await expect(
    card(page, name).getByRole("button", { name: `Remove ${name} from favorites` }),
  ).toHaveAttribute("aria-pressed", "true");

  const filter = page.getByRole("button", { name: "Favorites only" });

  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/favorites=true/);
  await expect(card(page, name)).toBeVisible();
  await expect(card(page, other)).toHaveCount(0);

  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await expect(card(page, name)).toBeVisible();
  await expect(card(page, other)).toHaveCount(0);

  // Unmarked under the filter, it leaves the list.
  await card(page, name)
    .getByRole("button", { name: `Remove ${name} from favorites` })
    .click();
  await expect(card(page, name)).toHaveCount(0);

  await filter.click();
  await expect(card(page, name)).toBeVisible();
  await expect(card(page, other)).toBeVisible();
});

test("the search finds a part of a title in any letter case, and the URL keeps it", async ({
  page,
  request,
}) => {
  const tag = randomBytes(3).toString("hex");
  const first = `Rooftop ${tag} runner`;
  const second = `Ballet ${tag} teacher`;

  await uploadThroughApi(request, first);
  await uploadThroughApi(request, second);
  await open(page, "/characters");

  const search = page.getByRole("searchbox", { name: "Search characters" });

  await search.fill(`${tag.toUpperCase()} RUNNER`);
  await expect(page).toHaveURL(new RegExp(`q=${tag}`, "i"));
  await expect(card(page, first)).toBeVisible();
  await expect(card(page, second)).toHaveCount(0);
  await expect(page.getByText(/^1 character matching/)).toBeVisible();

  await search.fill(tag);
  await expect(card(page, second)).toBeVisible();
  // Most recent first.
  expect((await cardNames(page)).slice(0, 2)).toEqual([second, first]);

  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await expect(search).toHaveValue(tag);
  await expect(card(page, first)).toBeVisible();

  await search.fill("nobody-is-called-this");
  await expect(page.getByText("No characters found")).toBeVisible();
});

test("a workspace with only the samples says so and still offers the samples", async ({ page }) => {
  // The run's shared database already has uploads from other tests: the page is shown the
  // server's own answer with every workspace character taken out, as a fresh install has it.
  await page.route("**/api/characters", async (route) => {
    const response = await route.fetch();
    const body = await response.json();

    await route.fulfill({
      json: {
        characters: body.characters.filter(({ is_sample }: { is_sample: boolean }) => is_sample),
      },
      response,
    });
  });
  await open(page, "/characters");
  await expect(page.locator('[data-empty="workspace"]')).toContainText(
    "No characters of your own yet",
  );
  await expect(card(page, "Placeholder blue")).toBeVisible();
  await expect(card(page, "Placeholder blue").getByText("Sample", { exact: true })).toBeVisible();
  await expect(page.getByText("3 characters")).toBeVisible();
});

test("without a session the library lists nothing, explains the access code, and opens once it is entered", async ({
  baseURL,
  browser,
  playwright,
  request,
}) => {
  const character = await uploadThroughApi(request, unique("Private likeness"));
  const visitor = await playwright.request.newContext({ baseURL, storageState: anonymous });

  expect((await visitor.get("/api/characters")).status()).toBe(401);
  // An uploaded photo is never shown to a visitor without the code.
  expect((await visitor.get(`/media/${character.image_asset_id}.png`)).status()).toBe(401);
  await visitor.dispose();

  const context = await browser.newContext({ storageState: anonymous });
  const page = await context.newPage();

  await open(page, "/characters");

  const panel = page.locator('[data-state="access-required"]');

  await expect(panel).toContainText("Enter an access code to open the library");
  await expect(panel.getByRole("link", { name: "Use the access page" })).toHaveAttribute(
    "href",
    "/access?next=%2Fcharacters",
  );
  await expect(page.getByRole("list", { name: "Characters" })).toHaveCount(0);
  await expect(page.locator(`img[src*="${character.image_asset_id}"]`)).toHaveCount(0);

  await panel.getByRole("button", { name: "Enter access code" }).click();
  await page.getByRole("textbox", { name: "Access code" }).fill(accessCode());
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(grid(page).locator(`[data-character-id="${character.id}"]`)).toBeVisible();
  await context.close();
});

test("Animate opens Motion Transfer with the character picked, keeping the motion and direction the library was opened with", async ({
  page,
}) => {
  const motion = seededResult().sourceAssetId;
  const draft = { angle: "none", motion, prompt: "Neon street at night" };

  await open(page, `/characters?draft=${encodeURIComponent(JSON.stringify(draft))}`);
  await expect(page.getByText("Your motion and direction are kept")).toBeVisible();

  const sample = card(page, "Placeholder green");
  const id = await sample.getAttribute("data-character-id");

  await sample.getByRole("link", { name: "Animate Placeholder green" }).click();
  await page.waitForURL(/\/motionTransfer\?/);

  const search = new URL(page.url()).searchParams;

  expect(search.get("character")).toBe(id);
  expect(search.get("motion")).toBe(motion);
  expect(search.get("angle")).toBe("none");
  expect(search.get("prompt")).toBe("Neon street at night");
  await page.locator("html[data-hydrated]").waitFor();
  // Both picks are there, so the wizard opens on Direct.
  await expect(page).toHaveURL(/step=direct|\/motionTransfer\?(?!.*step=)/);
  await expect(page.getByRole("complementary", { name: "Your shot" })).toContainText(
    "Placeholder green",
  );

  // Without a draft, the character alone: the wizard asks for a motion.
  await open(page, "/characters");
  await card(page, "Placeholder green")
    .getByRole("link", { name: "Animate Placeholder green" })
    .click();
  await page.waitForURL((url) => url.pathname === "/motionTransfer");
  expect(new URL(page.url()).searchParams.get("character")).toBe(id);
  expect(new URL(page.url()).searchParams.get("motion")).toBeNull();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pick a motion");
});

test("the library fits a phone and a desktop without scrolling sideways, and works from the keyboard", async ({
  page,
}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ height: 900, width });
    await open(page, "/characters");
    await expect(grid(page)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      `/characters at ${width} px`,
    ).toBeLessThanOrEqual(0);
  }

  const search = page.getByRole("searchbox", { name: "Search characters" });
  const filter = page.getByRole("button", { name: "Favorites only" });

  await search.focus();
  await page.keyboard.press("Tab");
  await expect(filter).toBeFocused();
  await page.keyboard.press("Space");
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(filter).toHaveAttribute("aria-pressed", "false");

  const sample = card(page, "Placeholder orange");

  await sample.getByRole("button", { name: "Add Placeholder orange to favorites" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    sample.getByRole("button", { name: "Remove Placeholder orange from favorites" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(
    sample.getByRole("button", { name: "Add Placeholder orange to favorites" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Tab");
  await expect(sample.getByRole("link", { name: "Animate Placeholder orange" })).toBeFocused();
});

test("the composer's character step lists the workspace library and goes to it and back with the motion kept", async ({
  page,
  request,
}) => {
  const name = unique("Library dancer");
  const character = await uploadThroughApi(request, name);
  const motion = seededResult().sourceAssetId;

  await open(page, `/motionTransfer?step=character&motion=${motion}`);

  const picker = page.getByRole("list", { name: "Characters" });

  // Saved in the library before: offered here with the samples, most recent first.
  await expect(picker.getByRole("button", { name })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Placeholder blue" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Describe a character" })).toHaveCount(0);

  await page.getByRole("link", { name: "Open the library" }).click();
  await page.waitForURL((url) => url.pathname === "/characters");
  await page.locator("html[data-hydrated]").waitFor();
  await expect(page.getByText("Your motion and direction are kept")).toBeVisible();

  await card(page, name)
    .getByRole("link", { name: `Animate ${name}` })
    .click();
  await page.waitForURL((url) => url.pathname === "/motionTransfer");

  const search = new URL(page.url()).searchParams;

  expect(search.get("character")).toBe(character.id);
  expect(search.get("motion")).toBe(motion);
  await expect(page.getByRole("complementary", { name: "Your shot" })).toContainText(name);
});

test("a character whose image does not load shows a placeholder and can still be renamed and animated", async ({
  page,
  request,
}) => {
  const name = unique("Lost image");
  const character = await uploadThroughApi(request, name);

  await page.route(`**/media/${character.image_asset_id}.*`, (route) =>
    route.fulfill({ body: "", status: 404 }),
  );
  await open(page, `/characters?selected=${character.id}`);

  const lost = card(page, name);

  await expect(lost.locator('[data-image-state="missing"]')).toContainText("Image unavailable");
  await expect(lost.getByRole("link", { name: `Animate ${name}` })).toHaveAttribute(
    "href",
    `/motionTransfer?character=${character.id}`,
  );
  await lost.getByRole("button", { name: `Rename ${name}` }).click();
  await expect(page.getByRole("dialog", { name: "Rename character" })).toBeVisible();
});

test("a library that could not be read says so and loads on Try again", async ({ page }) => {
  // Every read fails until the visitor tries again.
  let failing = true;

  await page.route("**/api/characters", (route) =>
    failing
      ? route.fulfill({ json: { error: "The library is unavailable." }, status: 500 })
      : route.fallback(),
  );
  await open(page, "/characters");

  const alert = page.getByRole("alert").filter({ hasText: "could not be loaded" });

  await expect(alert).toContainText("The library is unavailable.");
  failing = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(card(page, "Placeholder blue")).toBeVisible();
  await expect(alert).toHaveCount(0);
});
