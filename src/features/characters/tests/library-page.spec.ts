import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";

import {
  accessCode,
  count,
  open,
  sampleCharacter,
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

/** Chooses `item` in a card's menu. */
async function choose(page: Page, article: Locator, item: "Details" | "Rename") {
  await article.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("a photo uploaded with consent joins the library, newest first, and stays after a reload and in a new session", async ({
  browser,
  page,
}) => {
  const uploads = count("characters WHERE origin = 'upload'");

  await open(page, "/characters");
  await expect(page.getByText("Shared with everyone in this workspace.")).toBeVisible();
  // The composition links the builder: no draft to carry from here.
  await expect(page.getByRole("link", { name: "Describe a character" })).toHaveAttribute(
    "href",
    "/characters/new",
  );
  await expect(grid(page)).toBeVisible();

  const upload = page.getByRole("dialog", { name: "Add a photo" });

  await page.getByLabel("Upload a photo").setInputFiles(uniquePng());
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
  await choose(page, added, "Details");
  await expect(page.getByRole("dialog").getByText(/^Uploaded \w/)).toBeVisible();
  await page.keyboard.press("Escape");
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

  const upload = page.getByRole("dialog", { name: "Add a photo" });

  // A text file named like a PNG: the server checks the content.
  await page.getByLabel("Upload a photo").setInputFiles({
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
  await page.getByLabel("Upload a photo").setInputFiles(uniquePng());
  await expect(upload.getByRole("alert")).toHaveCount(0);
  await expect(upload.getByRole("button", { name: "Add to library" })).toBeDisabled();
  await upload.getByRole("checkbox", { name: /likeness/ }).check();
  await upload.getByRole("button", { name: "Add to library" }).click();
  await expect(page).toHaveURL(/selected=/);
  expect(count("characters")).toBe(characters + 1);
});

test("untitled characters' cards and controls have names that tell them apart", async ({
  page,
  request,
}) => {
  const first = await uploadThroughApi(request);
  const second = await uploadThroughApi(request);

  await open(page, "/characters");

  const labels = await Promise.all(
    [first, second].map((character) =>
      grid(page).locator(`[data-character-id="${character.id}"]`).getAttribute("aria-label"),
    ),
  );

  expect(labels[0]).not.toBe(labels[1]);

  for (const label of labels) {
    expect(label).toMatch(/^Untitled photo, uploaded \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);

    for (const control of [`More for ${label}`, `Animate ${label}`, `Add ${label} to favorites`]) {
      await expect(
        page.getByRole(control.startsWith("Animate") ? "link" : "button", {
          exact: true,
          name: control,
        }),
      ).toHaveCount(1);
    }
  }
});

test("a character is renamed in a dialog, 1–80 characters, and keeps its name after a reload", async ({
  page,
  request,
}) => {
  const character = await uploadThroughApi(request);
  const name = unique("Stage name");

  await open(page, `/characters?selected=${character.id}`);

  const added = grid(page).locator(`[data-character-id="${character.id}"]`);

  // Untitled: named by what it is and when it was added, so its controls say which one they act on.
  await expect(added).toHaveAttribute(
    "aria-label",
    /^Untitled photo, uploaded \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC( \(\d+\))?$/,
  );
  await expect(
    added.getByRole("button", { name: /^More for Untitled photo, uploaded / }),
  ).toBeVisible();
  await choose(page, added, "Rename");

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
  await card(page, "Arthur").getByRole("button", { name: "More for Arthur" }).click();
  await expect(page.getByRole("menuitem", { name: "Details" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
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

  const filter = page.getByRole("radio", { name: "Favorites" });

  await filter.click();
  await expect(filter).toBeChecked();
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

  await page.getByRole("radio", { name: "All" }).click();
  await expect(card(page, name)).toBeVisible();
  await expect(card(page, other)).toBeVisible();
});

test("the Samples filter shows only the samples, and the URL keeps it", async ({
  page,
  request,
}) => {
  const name = unique("Not a sample");

  await uploadThroughApi(request, name);
  await open(page, "/characters");
  await expect(card(page, name)).toBeVisible();

  await page.getByRole("radio", { name: "Samples" }).click();
  await expect(page).toHaveURL(/samples=true/);
  await expect(card(page, name)).toHaveCount(0);
  await expect(card(page, "Arthur")).toBeVisible();

  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await expect(page.getByRole("radio", { name: "Samples" })).toBeChecked();
  await expect(card(page, name)).toHaveCount(0);
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
  await expect(page.getByText("No characters match")).toBeVisible();
});

test("a workspace with only the samples still offers the samples", async ({ page }) => {
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
  await expect(card(page, "Arthur")).toBeVisible();
  await expect(page.getByText("6 characters")).toBeAttached();
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
  const draft = { motion, prompt: "Neon street at night" };

  await open(page, `/characters?draft=${encodeURIComponent(JSON.stringify(draft))}`);
  await expect(page.getByText("Your motion and direction are kept")).toBeVisible();

  const sample = card(page, "Kenji");
  const id = await sample.getAttribute("data-character-id");

  await sample.getByRole("link", { name: "Animate Kenji" }).click();
  await page.waitForURL(/\/motionTransfer\?/);

  const search = new URL(page.url()).searchParams;

  expect(search.get("character")).toBe(id);
  expect(search.get("motion")).toBe(motion);
  expect(search.get("prompt")).toBe("Neon street at night");
  await page.locator("html[data-hydrated]").waitFor();
  // Both picks are there, so the wizard opens on Direct.
  await expect(page).toHaveURL(/step=direct|\/motionTransfer\?(?!.*step=)/);
  await expect(page.getByRole("complementary", { name: "Your shot" })).toContainText("Kenji");

  // Without a draft, the character alone: the wizard asks for a motion.
  await open(page, "/characters");
  await card(page, "Kenji").getByRole("link", { name: "Animate Kenji" }).click();
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
  const all = page.getByRole("radio", { name: "All" });
  const filter = page.getByRole("radio", { name: "Favorites" });

  await search.focus();
  await page.keyboard.press("Tab");
  await expect(all).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(filter).toBeFocused();
  await page.keyboard.press("Space");
  await expect(filter).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await expect(all).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(all).toBeChecked();

  const sample = card(page, "Maya");

  await sample.getByRole("button", { name: "Add Maya to favorites" }).focus();
  await page.keyboard.press("Enter");
  await expect(sample.getByRole("button", { name: "Remove Maya from favorites" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(sample.getByRole("button", { name: "Add Maya to favorites" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  // Animate and the menu show when the keyboard reaches them; the menu has what made a sample.
  await page.keyboard.press("Tab");
  await expect(sample.getByRole("link", { name: "Animate Maya" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(sample.getByRole("button", { name: "More for Maya" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Maya" })).toContainText("Sample character");
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
  await expect(picker.getByRole("button", { name: "Arthur" })).toBeVisible();

  // The builder's link carries the draft too, its motion included.
  const builder = new URL(
    (await page.getByRole("link", { name: "Describe a new one" }).getAttribute("href")) ?? "",
    "http://localhost",
  );

  expect(builder.pathname).toBe("/characters/new");
  expect(JSON.parse(builder.searchParams.get("draft") ?? "{}")).toMatchObject({ motion });

  await page.getByRole("link", { name: "Open library" }).click();
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
  await choose(page, lost, "Rename");
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

  const alert = page.getByRole("alert").filter({ hasText: "The library didn't load" });

  await expect(alert).toContainText("The library is unavailable.");
  failing = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(card(page, "Arthur")).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test("a rename answered after its dialog was dismissed keeps the name but leaves another character's open dialog alone", async ({
  page,
  request,
}) => {
  const first = unique("First rename");
  const second = unique("Second rename");
  const a = await uploadThroughApi(request, first);

  const b = await uploadThroughApi(request, second);

  // A's save is held until B's dialog is open.
  let release = () => {};

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(`**/api/characters/${a.id}`, async (route) => {
    await held;
    await route.continue();
  });
  await open(page, "/characters");

  const dialog = page.getByRole("dialog", { name: "Rename character" });
  const renamed = unique("Renamed late");

  await choose(page, card(page, first), "Rename");
  await dialog.getByLabel("Name").fill(renamed);
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(dialog.getByRole("button", { name: "Saving…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await choose(page, card(page, second), "Rename");
  await dialog.getByLabel("Name").fill("Not saved yet");
  release();

  // A's answer lands: the library shows its new name, B's dialog stays open with its draft.
  // (The modal hides the page from the accessibility tree: the cards are found by their ids.)
  await expect(page.locator(`[data-character-id="${a.id}"]`)).toHaveAttribute(
    "aria-label",
    renamed,
  );
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Name")).toHaveValue("Not saved yet");
  await expect(page.locator(`[data-character-id="${b.id}"]`)).toHaveAttribute("aria-label", second);
});

test("closing the rename dialog returns the focus to the card's menu button, or to the heading once a rename leaves the search", async ({
  page,
  request,
}) => {
  const tag = randomBytes(3).toString("hex");
  const name = `Alice-${tag}`;

  await uploadThroughApi(request, name);
  await open(page, `/characters?q=Alice-${tag}`);
  await expect(card(page, name)).toBeVisible();

  const dialog = page.getByRole("dialog", { name: "Rename character" });
  const more = card(page, name).getByRole("button", { name: `More for ${name}` });

  /** The menu's first item, Rename, from the keyboard. */
  const rename = async () => {
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog.getByLabel("Name")).toBeFocused();
  };

  // Escape and Cancel give the focus back to the menu's button.
  await more.focus();
  await rename();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();

  await rename();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(more).toBeFocused();

  // A save that still matches the search: the same button.
  const still = `Alice-${tag} on stage`;

  await rename();
  await dialog.getByLabel("Name").fill(still);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(card(page, still).getByRole("button", { name: `More for ${still}` })).toBeFocused();

  // A save the search no longer matches: the card leaves, the empty result shows, and the
  // focus goes to the page's heading.
  await rename();
  await dialog.getByLabel("Name").fill(`Bob ${tag}`);
  await dialog.getByRole("button", { name: "Save name" }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, still)).toHaveCount(0);
  await expect(page.getByText("No characters match")).toBeVisible();
  await expect(page.getByText(`0 characters matching “Alice-${tag}”`)).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Characters" }).locator("span"),
  ).toBeFocused();
});

test("a rename answered after the search changed keeps the character in the list the page now shows", async ({
  page,
  request,
}) => {
  const tag = randomBytes(3).toString("hex");
  const name = `Alice-${tag}`;
  const character = await uploadThroughApi(request, name);

  let release = () => {};

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(`**/api/characters/${character.id}`, async (route) => {
    await held;
    await route.continue();
  });
  await open(page, `/characters?q=Alice-${tag}`);

  const dialog = page.getByRole("dialog", { name: "Rename character" });
  const renamed = `Bob-${tag}`;

  await choose(page, card(page, name), "Rename");
  await dialog.getByLabel("Name").fill(renamed);
  await dialog.getByRole("button", { name: "Save name" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The search is cleared while the save is pending: the whole library shows.
  await page.getByRole("searchbox", { name: "Search characters" }).fill("");
  await expect(page).not.toHaveURL(/q=/);
  await expect(card(page, name)).toBeVisible();
  release();

  await expect(card(page, renamed)).toBeVisible();
  await expect(card(page, name)).toHaveCount(0);
});

test("a character saved from a generation says it is AI-generated, with what made it", async ({
  page,
}) => {
  // A generated character as `createFromGeneration` stores one, on the run's done generation and
  // a sample's image (the browser run has no image workflow to finish).
  const name = unique("Generated dancer");
  const id = randomUUID();
  const database = new DatabaseSync(process.env.E2E_DATABASE_PATH ?? "");

  try {
    database
      .prepare(
        `INSERT INTO characters (id, title, image_asset_id, origin, prompt, generation_id,
          provenance, created_at)
        VALUES (?, ?, ?, 'generated', ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        sampleCharacter().imageAssetId,
        "A street dancer in a red hoodie, full body",
        seededResult().id,
        JSON.stringify({
          models: [
            {
              file: "flux3-image-klein-int8-convrot.safetensors",
              license: "flux-kommunity-license",
              sha256: "a".repeat(64),
            },
          ],
          workflow: { id: "character-generation", sha256: "b".repeat(64), version: 1 },
        }),
        new Date().toISOString(),
      );
  } finally {
    database.close();
  }

  await open(page, "/characters");

  const generated = card(page, name);

  await expect(generated.getByText("AI-generated", { exact: true })).toBeVisible();
  await choose(page, generated, "Details");

  const details = page.getByRole("dialog", { name });

  await expect(details.getByText(/^AI image, generated /)).toBeVisible();
  await expect(details).toContainText("A street dancer in a red hoodie, full body");
  await expect(details).toContainText("character-generation v1");
  await expect(details).toContainText("flux3-image-klein-int8-convrot");
});
