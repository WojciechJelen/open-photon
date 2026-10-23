// The character builder (`/characters/new`) against the e2e server, whose Comfy is a dead port:
// access, validation, the request keys that keep a double click or a reload from paying twice,
// failures and their recovery. The flows that need a finished caption or image run against the
// fake provider (`builder.fake.spec.ts`).
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

test("a failed enhancement says why and Try again starts its retry", async ({ page }) => {
  await describe(page, "A courier who never arrives");
  await page.getByRole("button", { name: "Enhance caption" }).click();

  const failure = page.getByRole("alert");

  await expect(failure).toContainText("The caption couldn't be made");
  await expect(failure).toContainText("provider_unreachable");

  const first = searchId(page, "caption");
  const before = count(captions);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).not.toHaveURL(new RegExp(`caption=${first}`));
  expect(count(captions)).toBe(before + 1);

  const retried = await (
    await page.request.get(`/api/generations/${searchId(page, "caption")}`)
  ).json();

  expect(retried.parent_id).toBe(first);
});

test("a caption written by hand is sent byte for byte, and a failed image offers a retry", async ({
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

  const recipe = await (
    await page.request.get(`/api/generations/${searchId(page, "image")}/recipe.json`)
  ).json();

  expect(recipe.caption).toBe(caption);
  expect(recipe.source).toMatchObject({ description: "A tall gardener", enhancement: null });

  await page.getByRole("button", { name: "Try again with a new seed" }).click();
  await expect(page).toHaveURL(/image=[0-9a-f-]{36}/);
  await expect.poll(() => count(images)).toBe(before + 2);
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
