import { expect, test } from "@playwright/test";

import { count, open, seededResult } from "../../../../tests/e2e/session.ts";

const uuid = "[0-9a-f-]{36}";

/** The character step, with the sample motion picked. */
const characterStep = () => `/motionTransfer?step=character&motion=${seededResult().sourceAssetId}`;

test("a picked motion and sample character stay in the URL and survive a reload", async ({
  page,
}) => {
  await open(page, "/motionTransfer");
  await page.getByRole("button", { name: "Street dance" }).click();
  await expect(page).toHaveURL(new RegExp(`step=motion&motion=${uuid}$`));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Arthur" }).click();
  await expect(page).toHaveURL(new RegExp(`step=character&motion=${uuid}&character=${uuid}$`));

  const url = page.url();

  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  expect(page.url()).toBe(url);
  await expect(page.getByRole("button", { name: "Arthur" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const slate = page.getByRole("complementary", { name: "Your shot" });

  await expect(slate).toContainText("Street dance");
  await expect(slate).toContainText("Arthur");
});

test("an uploaded photo asks for consent once, under its preview; with it the character is created and picked", async ({
  page,
}) => {
  const uploads = count("characters WHERE origin = 'upload'");

  await open(page, characterStep());
  await page.getByLabel("Upload a photo").setInputFiles("fixtures/wan/reference.png");
  await expect(page.getByRole("img", { name: "The photo you picked" })).toBeVisible();

  const submit = page.getByRole("button", { name: "Use photo" });

  await expect(submit).toBeDisabled();
  expect(count("characters WHERE origin = 'upload'")).toBe(uploads);

  await page.getByLabel("I may use this person's likeness").check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(new RegExp(`character=${uuid}$`));

  // The library picker lists the new photo, picked, as an untitled upload of the workspace.
  const picked = page.getByRole("list", { name: "Characters" }).getByRole("button", {
    pressed: true,
  });

  await expect(picked).toHaveCount(1);
  await expect(picked).toContainText("Untitled photo");

  const chosen = new URL(page.url()).searchParams.get("character");

  expect(
    count(`characters WHERE id = '${chosen}' AND origin = 'upload' AND consent_at IS NOT NULL`),
  ).toBe(1);
  expect(count("characters WHERE origin = 'upload'")).toBe(uploads + 1);
});

test("a file that is not an image is refused in the dialog and creates nothing; closing it clears the refusal", async ({
  page,
}) => {
  const characters = count("characters");

  await open(page, characterStep());
  await page.getByLabel("Upload a photo").setInputFiles("fixtures/x.mp4");
  await page.getByLabel("I may use this person's likeness").check();
  await page.getByRole("button", { name: "Use photo" }).click();

  const tile = page.locator("[data-upload-state]");

  await expect(tile).toHaveAttribute("data-reason", "not_image");
  await expect(tile.getByRole("alert")).toContainText("Not an image");
  expect(count("characters")).toBe(characters);
  await expect(page).not.toHaveURL(/character=/);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Arthur" }).click();
  await expect(page).toHaveURL(/character=/);
});

test("a character id that names no character falls back to none", async ({ page }) => {
  for (const character of ["xyz", crypto.randomUUID()]) {
    await open(page, `${characterStep()}&character=${character}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who performs it?");
    await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(0);
  }
});
