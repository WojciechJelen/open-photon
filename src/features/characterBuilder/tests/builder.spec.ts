// The character builder (`/characters/new`) against the e2e server, whose Comfy is a dead port:
// access, validation, the request keys that keep a double click or a reload from paying twice,
// failures and their recovery. The flows that need a finished caption or image run against the
// fake provider (`builder.fake.spec.ts`).
import { setTimeout as delay } from "node:timers/promises";

import { expect, type Page, test } from "@playwright/test";

import { accessCode, count, open } from "../../../../tests/e2e/session.ts";

const captions = "generations WHERE workflow_id = 'character-caption'";
const images = "generations WHERE workflow_id = 'character-generation'";

/** The id a builder URL search member names. */
function searchId(page: Page, name: "caption" | "image") {
  return new URL(page.url()).searchParams.get(name);
}

async function describe(page: Page, description: string) {
  await open(page, "/characters/new");
  await page.getByLabel("Description", { exact: true }).fill(description);
}

test.describe("without the access code", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the builder asks for the code first", async ({ page }) => {
    await page.goto("/characters/new");

    await expect(page).toHaveURL(/\/access\?next=%2Fcharacters%2Fnew/);
  });

  test("reached by a link inside the app, the builder says it needs the code, and Enhance asks for it", async ({
    page,
  }) => {
    const before = count(captions);

    await open(page, "/");
    await page
      .locator("#tools")
      .getByRole("link", { name: /Describe a character/ })
      .click();
    await page.waitForURL((url) => url.pathname === "/characters/new");
    await expect(page.getByRole("heading", { name: "Describe your character" })).toBeVisible();

    await expect(page.getByText("Code active")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Access code" })).toBeVisible();

    await page.getByLabel("Description", { exact: true }).fill("A lighthouse keeper");
    await page.getByRole("button", { name: "Enhance caption" }).click();
    await expect(page.getByRole("dialog", { name: "Enter your access code" })).toBeVisible();
    expect(count(captions)).toBe(before);
  });
});

test("Start over clears the description, controls and seed, here and after a reload, and keeps what was sent", async ({
  page,
}) => {
  const before = count(captions);

  await describe(page, "A keeper who starts over");
  await page.getByLabel("Appearance (optional)").fill("Grey beard");
  await page.getByRole("button", { name: "Enhance caption" }).click();
  await expect(page).toHaveURL(/caption=[0-9a-f-]{36}/);
  expect(count(captions)).toBe(before + 1);

  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/characters/new" && url.search === "");
  await expect(page.getByRole("heading", { name: "Describe your character" })).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Appearance (optional)")).toHaveValue("");

  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Appearance (optional)")).toHaveValue("");

  // The caption sent before is still stored; nothing was sent or deleted by starting over.
  expect(count(captions)).toBe(before + 1);
});

test("Enhance checks the description in the browser and sends nothing invalid", async ({
  page,
}) => {
  const before = count(captions);

  await open(page, "/characters/new");
  await page.getByRole("button", { name: "Enhance caption" }).click();

  await expect(page.getByRole("alert")).toContainText("Describe the character in 1 to 1000");
  await expect(page.getByLabel("Description", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(count(captions)).toBe(before);
});

test("a double click enhances once, and a reload follows the same caption", async ({ page }) => {
  const before = count(captions);

  await describe(page, "A double-clicked lighthouse keeper");
  await page.getByRole("button", { name: "Enhance caption" }).dblclick();
  await expect(page).toHaveURL(/caption=[0-9a-f-]{36}/);

  const first = searchId(page, "caption");

  await expect(page.getByRole("heading", { name: "Review the caption" })).toBeFocused();
  expect(count(captions)).toBe(before + 1);

  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  // Comfy is at a dead port: the enhancement failed, and the reload shows it, nothing new.
  await expect(page.getByRole("alert")).toContainText("The caption couldn't be made");
  expect(searchId(page, "caption")).toBe(first);
  expect(count(captions)).toBe(before + 1);

  // The same description sent again (back, Enhance) is the same request: no new caption.
  await page.getByRole("button", { name: "Edit the description" }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "A double-clicked lighthouse keeper",
  );
  await page.getByRole("button", { name: "Enhance caption" }).click();
  await expect(page.getByRole("heading", { name: "Review the caption" })).toBeVisible();
  expect(searchId(page, "caption")).toBe(first);
  expect(count(captions)).toBe(before + 1);
});

/**
 * The next `times` answers of `POST <path>` are lost on the way back: the request reaches the
 * server (and its generation is stored), the page gets no answer.
 */
async function loseAnswers(page: Page, path: string, times = 1) {
  let left = times;

  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST" || left === 0) {
      await route.fallback();

      return;
    }

    left -= 1;
    await route.fetch();
    await route.abort("connectionreset");
  });
}

/** The refusal notice's own "Try again" (the same request, with its same key). */
function resend(page: Page) {
  return page.locator("[data-reason]").getByRole("button", { name: "Try again" });
}

test("Try again on a failed enhancement is one new request, through a lost answer and a reload", async ({
  page,
}) => {
  await describe(page, "A courier who never arrives");
  await page.getByRole("button", { name: "Enhance caption" }).click();

  const failure = page.getByRole("alert");

  await expect(failure).toContainText("The caption couldn't be made");
  await expect(failure).toContainText("provider_unreachable");

  const first = searchId(page, "caption");
  const before = count(captions);

  // The retry reaches the server, its answer is lost: sending it again is the same request.
  await loseAnswers(page, "/api/character-captions");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(resend(page)).toBeVisible();
  expect(count(captions)).toBe(before + 1);

  // A reload forgets nothing: the failed caption's Try again is still that request.
  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).not.toHaveURL(new RegExp(`caption=${first}`));
  await expect(page.getByRole("alert")).toContainText("The caption couldn't be made");
  expect(count(captions)).toBe(before + 1);
});

test("a caption written by hand is sent byte for byte, and Try again on its failed image is one request", async ({
  page,
}) => {
  const before = count(images);
  // Leading and trailing whitespace and an inner blank line: nothing may trim or rewrite them.
  const caption = "  A full-body portrait of a tall gardener in green overalls.\n\nPlain wall.  \n";

  await describe(page, "A tall gardener");
  await page.getByRole("button", { name: "Write the caption myself" }).click();

  const box = page.getByLabel("Your caption");

  // It starts from the compiled request: the description with the full-body framing.
  await expect(box).toHaveValue(/A tall gardener/);
  await box.fill(caption);
  await page.getByRole("button", { name: "Generate character" }).dblclick();

  await expect(page).toHaveURL(/image=[0-9a-f-]{36}/);
  await expect(page.getByRole("alert")).toContainText("The image couldn't be made");
  expect(count(images)).toBe(before + 1);

  const failed = searchId(page, "image");
  const recipe = await (await page.request.get(`/api/generations/${failed}/recipe.json`)).json();

  expect(recipe.caption).toBe(caption);
  expect(recipe.source).toMatchObject({ description: "A tall gardener", enhancement: null });

  // Try again while the recipe is slow to read, double-clicked: one request.
  await page.route("**/recipe.json", async (route) => {
    await delay(1000);
    await route.fallback();
  });
  await loseAnswers(page, "/api/character-generations");
  await page.getByRole("button", { name: "Try again with a new seed" }).dblclick();
  await expect(resend(page)).toBeVisible();
  expect(count(images)).toBe(before + 2);

  // Its answer was lost; after a reload, Try again is still that request.
  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await page.getByRole("button", { name: "Try again with a new seed" }).click();
  await expect(page).not.toHaveURL(new RegExp(`image=${failed}`));
  await expect(page.getByRole("alert")).toContainText("The image couldn't be made");
  expect(count(images)).toBe(before + 2);

  const retried = await (
    await page.request.get(`/api/generations/${searchId(page, "image")}/recipe.json`)
  ).json();

  expect(retried.caption).toBe(caption);
  expect(retried.source).toEqual(recipe.source);
});

test("Edit the caption opens the image's own caption and seed, in a cold tab and over another draft", async ({
  browser,
  page,
}) => {
  const caption = "A full-body portrait of a beekeeper in a white suit.  \n";

  await describe(page, "A beekeeper");
  await page.getByLabel("Appearance (optional)").fill("Tall, grey beard");
  await page.getByRole("button", { name: "Write the caption myself" }).click();
  await page.getByLabel("Your caption").fill(caption);
  await page.getByRole("button", { name: "Generate character" }).click();
  await expect(page.getByRole("alert")).toContainText("The image couldn't be made");

  const image = searchId(page, "image");
  const recipe = await (await page.request.get(`/api/generations/${image}/recipe.json`)).json();

  // Another tab whose storage holds another character's draft and caption.
  const context = await browser.newContext({ storageState: await page.context().storageState() });
  const other = await context.newPage();

  await other.addInitScript(() => {
    sessionStorage.setItem(
      "characterBuilder:form",
      JSON.stringify({
        appearance: "",
        caption: "Somebody else's caption",
        captionFor: "manual:[]",
        description: "Somebody else",
        outfit: "",
        seed: "7",
        style: null,
      }),
    );
  });

  for (const path of [
    `/characters/new?image=${image}&step=caption`,
    `/characters/new?image=${image}`,
  ]) {
    await open(other, path);

    if (!path.includes("step=caption")) {
      await other.getByRole("button", { name: "Edit the caption" }).click();
    }

    await expect(other.getByLabel("Your caption")).toHaveValue(caption);
    await other.getByRole("button", { name: /Advanced/ }).click();
    await expect(other.getByLabel("Seed")).toHaveValue(String(recipe.seed));
    await other.getByRole("button", { name: "Edit the description" }).click();
    await expect(other.getByLabel("Description", { exact: true })).toHaveValue("A beekeeper");
    await expect(other.getByLabel("Appearance (optional)")).toHaveValue("Tall, grey beard");
  }

  await context.close();
});

test("a caption written by hand belongs to its description: a new one starts afresh, the old one comes back", async ({
  page,
}) => {
  await describe(page, "A lighthouse keeper");
  await page.getByRole("button", { name: "Write the caption myself" }).click();
  await page.getByLabel("Your caption").fill("My own keeper caption");

  await page.getByRole("button", { name: "Edit the description" }).click();
  await page.getByLabel("Description", { exact: true }).fill("A ferry captain");
  await page.getByRole("button", { name: "Write the caption myself" }).click();
  await expect(page.getByLabel("Your caption")).toHaveValue(/^A ferry captain\. Framing:/);

  await page.getByRole("button", { name: "Edit the description" }).click();
  await page.getByLabel("Description", { exact: true }).fill("A lighthouse keeper");
  await page.getByRole("button", { name: "Write the caption myself" }).click();
  await expect(page.getByLabel("Your caption")).toHaveValue("My own keeper caption");
});

test.describe("where the tab's storage takes nothing", () => {
  test("a lost answer sent again is still one request, and the page says a reload forgets", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      };
    });

    const before = count(captions);

    await describe(page, "A clockmaker with no storage");
    await expect(page.getByRole("note")).toContainText("does not let the page remember");

    await loseAnswers(page, "/api/character-captions");
    await page.getByRole("button", { name: "Enhance caption" }).click();
    await expect(resend(page)).toBeVisible();
    expect(count(captions)).toBe(before + 1);

    // The page's own Enhance again, not the notice's: the same request all the same.
    await page.getByRole("button", { name: "Enhance caption" }).click();
    await expect(page).toHaveURL(/caption=[0-9a-f-]{36}/);
    expect(count(captions)).toBe(before + 1);
  });
});

test("an expired session asks for the code, then sends the same request", async ({ page }) => {
  const before = count(captions);

  await describe(page, "A night-shift baker");
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Enhance caption" }).click();

  const dialog = page.getByRole("dialog", { name: "Enter your access code" });

  await expect(dialog).toBeVisible();
  expect(count(captions)).toBe(before);

  await dialog.getByLabel("Access code").fill(accessCode());
  await dialog.getByRole("button", { name: "Unlock and generate" }).click();

  await expect(page).toHaveURL(/caption=[0-9a-f-]{36}/);
  await expect(dialog).toBeHidden();
  expect(count(captions)).toBe(before + 1);
});
