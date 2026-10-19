import { expect, test } from "@playwright/test";

import { count, open } from "./e2e/session.ts";

const uuid = "[0-9a-f-]{36}";

test("a picked motion and sample character stay in the URL and survive a reload", async ({
  page,
}) => {
  await open(page, "/");
  await page.getByRole("button", { name: "Street dance" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?motion=${uuid}$`));
  await page.getByRole("button", { name: "Placeholder blue" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?motion=${uuid}&character=${uuid}$`));

  const url = page.url();

  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  expect(page.url()).toBe(url);

  for (const name of ["Street dance", "Placeholder blue"]) {
    await expect(page.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  }

  await expect(page.getByRole("group", { name: "Chosen character" })).toContainText(
    "Placeholder blue",
  );
});

test("an uploaded photo needs the consent checkbox; with it the character is created and chosen", async ({
  page,
}) => {
  const uploads = count("characters WHERE origin = 'upload'");

  await open(page, "/");
  await page
    .getByLabel("Or upload a photo of a person")
    .setInputFiles("fixtures/wan/reference.png");

  const submit = page.getByRole("button", { name: "Use this photo" });

  await expect(submit).toBeDisabled();
  expect(count("characters WHERE origin = 'upload'")).toBe(uploads);

  await page.getByLabel("I may use this person's likeness").check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(new RegExp(`\\?character=${uuid}$`));
  await expect(page.getByRole("group", { name: "Chosen character" })).toContainText("your photo");
  expect(count("characters WHERE origin = 'upload' AND consent_at IS NOT NULL")).toBe(uploads + 1);
});

test("a file that is not an image is refused inline and creates nothing", async ({ page }) => {
  const characters = count("characters");

  await open(page, "/");
  await page.getByLabel("Or upload a photo of a person").setInputFiles("fixtures/x.mp4");
  await page.getByLabel("I may use this person's likeness").check();
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByRole("alert")).toHaveText("Upload a PNG, JPEG or WebP image.");
  expect(count("characters")).toBe(characters);
  await expect(page).toHaveURL(/\/$/);
});

test("a character id that names no character falls back to none", async ({ page }) => {
  for (const character of ["xyz", crypto.randomUUID()]) {
    await open(page, `/?character=${character}`);
    await expect(page.getByText("No character chosen yet.")).toBeVisible();
  }
});
