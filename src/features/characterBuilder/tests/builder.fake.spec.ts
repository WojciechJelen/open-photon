// The character builder end to end against the fake provider (the `fake` Playwright project):
// describe → enhance → edit the caption → generate → preview → save → animate, a failed image
// recovered by editing its caption, and publishing an image (the builder's and a library card's
// "Publish & copy link"). The fake provider answers a caption with
// `tests/fixtures/fake-output.txt` and an image with `tests/fixtures/fake-output.png`; a graph
// carrying `[fake:provider_failed]` fails.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

import { expect, type Page, test } from "@playwright/test";

import { accessCode, open } from "../../../../tests/e2e/session.ts";

const fakeCaption = readFileSync("tests/fixtures/fake-output.txt", "utf8");

/** One value from the fake provider's server's database (`playwright.config.ts`), read-only. */
function scalar(sql: string) {
  const database = new DatabaseSync(process.env.E2E_FAKE_DATABASE_PATH ?? "", { readOnly: true });

  try {
    return Object.values(database.prepare(sql).get() ?? {})[0];
  } finally {
    database.close();
  }
}

const countOf = (sql: string) => Number(scalar(`SELECT count(*) FROM ${sql}`));
const characters = "characters";
const images = "generations WHERE workflow_id = 'character-generation'";

function searchId(page: Page, name: "caption" | "image" | "saved") {
  return new URL(page.url()).searchParams.get(name);
}

/** A new image of a hand-written `caption` on the builder, shown once done; its generation id. */
async function generateImage(page: Page, caption: string) {
  await open(page, "/characters/new");
  await page.getByLabel("Description", { exact: true }).fill("A street performer");
  await page.getByRole("button", { name: "Write the caption myself" }).click();
  await page.getByLabel("Your caption").fill(caption);
  await page.getByRole("button", { name: "Generate character" }).click();
  await expect(page.getByRole("img", { name: /AI-generated character/ })).toBeVisible({
    timeout: 30_000,
  });

  return searchId(page, "image") ?? "";
}

/** A generation's share slug as stored; `null` while it is not published. */
function slugOf(id: string) {
  const slug = scalar(`SELECT share_slug FROM generations WHERE id = '${id}'`);

  return typeof slug === "string" ? slug : null;
}

test("describe, enhance, edit, generate, save and animate with the motion the visitor came with", async ({
  page,
}) => {
  // A seeded sample motion's clip, as the wizard's draft names a motion.
  const motion = String(scalar("SELECT source_asset_id FROM motions ORDER BY slug LIMIT 1"));

  await open(page, `/characters/new?draft=${encodeURIComponent(JSON.stringify({ motion }))}`);

  await page.getByLabel("Description", { exact: true }).fill("A retired lighthouse keeper");
  await page.getByLabel("Outfit (optional)").fill("Yellow raincoat");
  await page.getByRole("button", { name: "Anime" }).click();
  await expect(page.getByRole("button", { name: "Anime" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /What will be sent/ }).click();
  await expect(page.getByLabel("Compiled request")).toContainText("A retired lighthouse keeper");
  await expect(page.getByLabel("Compiled request")).toContainText("Yellow raincoat");

  await page.getByRole("button", { name: "Enhance caption" }).click();

  const box = page.getByLabel("Enhanced caption");

  await expect(box).toHaveValue(fakeCaption, { timeout: 30_000 });
  await expect(page.getByText("As enhanced")).toBeVisible();

  const captionId = searchId(page, "caption");
  // An edit kept exactly, trailing spaces and newline too.
  const edited = `${fakeCaption} Standing barefoot on wet sand.  \n`;

  await box.fill(edited);
  await expect(page.getByText("Edited", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Generate character" }).click();

  const image = page.getByRole("img", { name: /AI-generated character/ });

  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("image-caption")).toHaveText(edited, { useInnerText: false });

  const imageId = searchId(page, "image");
  const recipe = await (await page.request.get(`/api/generations/${imageId}/recipe.json`)).json();

  expect(recipe.caption).toBe(edited);
  expect(recipe.source.description).toBe("A retired lighthouse keeper");
  expect(recipe.source.controls).toMatchObject({ outfit: "Yellow raincoat", style: "anime" });
  expect(recipe.source.enhancement).toMatchObject({
    caption: fakeCaption,
    edited: true,
    generation_id: captionId,
  });
  await expect(page.getByTestId("image-seed")).toHaveText(String(recipe.seed));
  await expect(page.getByRole("link", { name: "Download image" })).toHaveAttribute(
    "href",
    /^\/media\/[0-9a-f-]{36}\.png$/,
  );
  // FLUX Kommunity licence: the output says it is AI-generated, and so does its file name.
  await expect(page.getByText("AI-generated image", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download image" })).toHaveAttribute(
    "download",
    /^ai-generated-character-/,
  );

  // Nothing is saved until the visitor chooses to.
  const before = countOf(characters);

  await page.getByLabel("Name (optional)").fill("Keeper");
  await page.getByRole("button", { name: "Save to library" }).click();

  const saved = page.getByRole("status").filter({ hasText: "Saved to the library" });

  await expect(saved).toContainText("“Keeper”");

  const characterId = searchId(page, "saved");

  expect(countOf(characters)).toBe(before + 1);

  // A reload shows it saved; saving the same image again is the same character.
  await page.reload();
  await expect(saved).toBeVisible({ timeout: 30_000 });

  const again = await page.request.post(`/api/character-generations/${imageId}/character`, {
    data: {},
  });

  expect(again.status()).toBe(200);
  expect((await again.json()).id).toBe(characterId);

  await open(page, `/characters/new?image=${imageId}`);
  await page.getByRole("button", { name: "Save to library" }).click();
  await expect(saved).toHaveAttribute("data-character", characterId ?? "");
  expect(countOf(characters)).toBe(before + 1);

  // Animate: the wizard, with the motion the visitor came with and the new character.
  await open(
    page,
    `/characters/new?image=${imageId}&saved=${characterId}&draft=${encodeURIComponent(JSON.stringify({ motion }))}`,
  );
  await page.getByRole("link", { name: "Animate this character" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/motionTransfer" &&
      url.searchParams.get("character") === characterId &&
      url.searchParams.get("motion") === motion,
  );

  // Without a draft, the wizard opens on motion selection with the character picked.
  await open(page, `/characters/new?image=${imageId}&saved=${characterId}`);
  await expect(page.getByRole("link", { name: "Animate this character" })).toHaveAttribute(
    "href",
    `/motionTransfer?character=${characterId}`,
  );
  await expect(page.getByRole("link", { name: "Open in library" })).toHaveAttribute(
    "href",
    `/characters?selected=${characterId}`,
  );

  // An action's error shows on a saved image too.
  await page.route("**/recipe.json", (route) =>
    route.fulfill({ json: { error: "The recipe store is down." }, status: 500 }),
  );
  await page.getByRole("button", { name: "Another image, same caption" }).click();
  await expect(page.getByRole("alert")).toContainText("The recipe store is down.");
  await page.unrouteAll();

  // "Another image" double-clicked while its recipe is slow to read: one new image.
  const beforeAnother = countOf(images);

  await page.route("**/recipe.json", async (route) => {
    await delay(1000);
    await route.fallback();
  });
  await page.getByRole("button", { name: "Another image, same caption" }).dblclick();
  await expect(page).not.toHaveURL(new RegExp(`image=${imageId}`));
  await expect(image).toBeVisible({ timeout: 30_000 });
  expect(countOf(images)).toBe(beforeAnother + 1);
  await page.unrouteAll();

  // The session expired: "Another image" asks for the code, then carries on.
  const shownImage = searchId(page, "image");

  await page.context().clearCookies();
  await page.getByRole("button", { name: "Another image, same caption" }).click();

  const dialog = page.getByRole("dialog", { name: "Enter your access code" });

  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Access code").fill(accessCode(process.env.E2E_FAKE_DATABASE_PATH));
  await dialog.getByRole("button", { name: "Unlock and generate" }).click();
  await expect(page).not.toHaveURL(new RegExp(`image=${shownImage}`));
  await expect(image).toBeVisible({ timeout: 30_000 });
  expect(countOf(images)).toBe(beforeAnother + 2);
});

test("a failed image says why; Try again is a new seed, and an edited caption renders", async ({
  page,
}) => {
  const before = countOf(images);

  await open(page, "/characters/new");
  await page.getByLabel("Description", { exact: true }).fill("A stunt double");
  await page.getByRole("button", { name: "Write the caption myself" }).click();
  await page.getByLabel("Your caption").fill("A stunt double, full body. [fake:provider_failed]");
  await page.getByRole("button", { name: "Generate character" }).click();

  await expect(page.getByRole("alert")).toContainText("The image couldn't be made", {
    timeout: 30_000,
  });

  const failed = searchId(page, "image");

  await page.getByRole("button", { name: "Try again with a new seed" }).click();
  await expect(page).not.toHaveURL(new RegExp(`image=${failed}`));
  await expect(page.getByRole("alert")).toContainText("The image couldn't be made", {
    timeout: 30_000,
  });
  expect(countOf(images)).toBe(before + 2);

  await page.getByRole("button", { name: "Edit the caption" }).click();
  await expect(page.getByLabel("Your caption")).toHaveValue(
    "A stunt double, full body. [fake:provider_failed]",
  );
  await page.getByLabel("Your caption").fill("A stunt double, full body.");
  await page.getByRole("button", { name: "Generate character" }).click();
  await expect(page.getByRole("img", { name: /AI-generated character/ })).toBeVisible({
    timeout: 30_000,
  });
  expect(countOf(images)).toBe(before + 3);

  // Another image of the same caption: a new generation with the caption and source unchanged.
  const first = searchId(page, "image");

  await page.getByRole("button", { name: "Another image, same caption" }).click();
  await expect(page).not.toHaveURL(new RegExp(`image=${first}`));
  await expect(page.getByRole("img", { name: /AI-generated character/ })).toBeVisible({
    timeout: 30_000,
  });
  expect(countOf(images)).toBe(before + 4);

  const recipe = await (
    await page.request.get(`/api/generations/${searchId(page, "image")}/recipe.json`)
  ).json();

  expect(recipe.caption).toBe("A stunt double, full body.");
  expect(recipe.source).toMatchObject({ description: "A stunt double", enhancement: null });
});

test("a caption or image whose status is unknown is never sent again from the page", async ({
  page,
}) => {
  const captions = "generations WHERE workflow_id = 'character-caption'";
  // The fake provider accepts the job, then the submit times out: the row is `unknown`.
  const description = "A mime who never answers [fake:ambiguous]";
  const beforeCaptions = countOf(captions);

  await open(page, "/characters/new");
  await page.getByLabel("Description", { exact: true }).fill(description);
  await page.getByRole("button", { name: "Enhance caption" }).click();
  await expect(page.getByRole("alert")).toContainText("The caption's status is unknown", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /Try again|Enhance/ })).toHaveCount(0);
  expect(countOf(captions)).toBe(beforeCaptions + 1);

  // The same description again is the same request: the same unknown caption, nothing new.
  const unknownCaption = searchId(page, "caption");

  await page.getByRole("button", { name: "Edit the description" }).click();
  await page.getByRole("button", { name: "Enhance caption" }).click();
  await expect(page.getByRole("alert")).toContainText("The caption's status is unknown");
  expect(searchId(page, "caption")).toBe(unknownCaption);
  expect(countOf(captions)).toBe(beforeCaptions + 1);

  const beforeImages = countOf(images);

  await page.getByRole("button", { name: "Edit the description" }).click();
  await page.getByLabel("Description", { exact: true }).fill("A juggler");
  await page.getByRole("button", { name: "Write the caption myself" }).click();
  await page.getByLabel("Your caption").fill("A juggler, full body. [fake:ambiguous]");
  await page.getByRole("button", { name: "Generate character" }).click();
  await expect(page.getByRole("alert")).toContainText("The image's status is unknown", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /Try again|new image|Another/ })).toHaveCount(0);
  expect(countOf(images)).toBe(beforeImages + 1);

  // Its own caption and seed, unchanged, are the request that made it: the image again, no job.
  const unknownImage = searchId(page, "image");

  await page.getByRole("button", { name: "Edit the caption" }).click();
  await expect(page.getByLabel("Your caption")).toHaveValue(
    "A juggler, full body. [fake:ambiguous]",
  );
  await page.getByRole("button", { name: "Generate character" }).click();
  await expect(page.getByRole("alert")).toContainText("The image's status is unknown");
  expect(searchId(page, "image")).toBe(unknownImage);
  expect(countOf(images)).toBe(beforeImages + 1);
});

test("an image stays private until Publish & copy link, then anyone opens its share page; a library card publishes its own", async ({
  browser,
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  const run = crypto.randomUUID().slice(0, 8);
  const imageId = await generateImage(page, `A juggler ${run}, full body, plain background.`);

  // Done, and private: no share page until its owner publishes it, which the page explains.
  expect(slugOf(imageId)).toBeNull();
  await expect(
    page.getByText(
      "Publishing makes this AI-generated image public at a share link; check it first.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Publish & copy link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Published" })).toHaveText(
    "Published. Link copied to the clipboard.",
  );

  const link = await page.getByLabel("Share link", { exact: true }).inputValue();

  expect(link).toMatch(/^http:\/\/[^/]+\/r\/[0-9a-f]{16}$/);
  expect(link.endsWith(`/r/${slugOf(imageId)}`)).toBe(true);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // Anyone: the share page, which says the image is AI-generated.
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonymous.newPage();
  const response = await visitor.goto(new URL(link).pathname);

  expect(response?.status()).toBe(200);
  await expect(visitor).toHaveTitle("AI-generated image · Open Photon");
  await expect(visitor.getByRole("img", { name: /AI-generated image/ })).toBeVisible();
  await anonymous.close();

  // Read again, it is published, with the same link.
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Published" })).toHaveText("Published", {
    timeout: 30_000,
  });
  await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(link);

  // A saved character of an image nobody published: its library card publishes it.
  const title = `Juggler ${run}`;
  const otherId = await generateImage(page, `A second juggler ${run}, full body.`);

  await page.getByLabel("Name (optional)").fill(title);
  await page.getByRole("button", { name: "Save to library" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved to the library" })).toBeVisible();
  await open(page, `/characters?q=${run}`);

  const card = page.getByRole("article", { name: title });
  const published = card.getByRole("status").filter({ hasText: "Published" });

  await card.getByRole("button", { name: `Publish & copy link: ${title}` }).click();
  await expect(published).toBeVisible();
  expect(slugOf(otherId)).toMatch(/^[0-9a-f]{16}$/);

  const cardLink = card.getByRole("textbox", { name: `Share link: ${title}` });

  await expect(cardLink).toHaveValue(new RegExp(`/r/${slugOf(otherId)}$`));

  // Read again: "Published" and its link, no publish button.
  await page.reload();
  await expect(published).toHaveText("Published", { timeout: 30_000 });
  await expect(cardLink).toHaveValue(new RegExp(`/r/${slugOf(otherId)}$`));
  await expect(card.getByRole("button", { name: /Publish & copy link/ })).toHaveCount(0);
});

test("publishing without a clipboard, or with copying refused, still publishes and leaves the link to copy; an earlier link starts with the server's share origin", async ({
  page,
}) => {
  const run = crypto.randomUUID().slice(0, 8);
  const title = `Busker ${run}`;

  // No clipboard at all, as on an origin that is not secure.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }),
  );

  const imageId = await generateImage(page, `A busker ${run}, full body, plain background.`);

  await page.getByRole("button", { name: "Publish & copy link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Published" })).toHaveText(
    "Published. Copying is not allowed here; copy the link below.",
  );
  expect(slugOf(imageId)).toMatch(/^[0-9a-f]{16}$/);
  await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
    new RegExp(`/r/${slugOf(imageId)}$`),
  );

  // A clipboard that refuses, as without permission: a library card publishes all the same.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException("Denied", "NotAllowedError")) },
    }),
  );

  const otherId = await generateImage(page, `A second busker ${run}, full body.`);

  await page.getByLabel("Name (optional)").fill(title);
  await page.getByRole("button", { name: "Save to library" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved to the library" })).toBeVisible();
  await open(page, `/characters?q=${run}`);

  const card = page.getByRole("article", { name: title });
  const cardLink = card.getByRole("textbox", { name: `Share link: ${title}` });

  await card.getByRole("button", { name: `Publish & copy link: ${title}` }).click();
  await expect(card.getByRole("status").filter({ hasText: "Published" })).toHaveText(
    "Published. Copying is not allowed here; copy the link below.",
  );
  await expect(cardLink).toHaveValue(new RegExp(`/r/${slugOf(otherId)}$`));

  // Read again behind a proxy (`PUBLIC_APP_URL`): links published earlier are the server's.
  await page.route("**/api/share-origin", (route) =>
    route.fulfill({ json: { origin: "https://photon.example" } }),
  );
  await page.reload();
  await expect(cardLink).toHaveValue(`https://photon.example/r/${slugOf(otherId)}`, {
    timeout: 30_000,
  });
  await open(page, `/characters/new?image=${imageId}`);
  await expect(page.getByLabel("Share link", { exact: true })).toHaveValue(
    `https://photon.example/r/${slugOf(imageId)}`,
    { timeout: 30_000 },
  );
});
