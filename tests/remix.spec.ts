import { expect, type Page, test } from "@playwright/test";

import { open, seededResult } from "./e2e/session.ts";

/** The current URL's search params, as one object. */
function searchOf(page: Page) {
  return Object.fromEntries(new URL(page.url()).searchParams);
}

test("Download saves the result's MP4 under a file name", async ({ page }) => {
  await open(page, `/g/${seededResult().id}`);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download MP4" }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^open-photon-[0-9a-f]{8}\.mp4$/);
  expect(await download.failure()).toBeNull();
});

test("each remix opens / keeping exactly one of motion and character", async ({ page }) => {
  const { characterId, id, sourceAssetId } = seededResult();

  await open(page, `/g/${id}`);
  await page.getByRole("link", { name: "Same motion, another character" }).click();
  await expect(page).toHaveURL(/\/\?motion=/);
  expect(searchOf(page)).toEqual({ motion: sourceAssetId });
  await expect(page.getByRole("group", { name: "Chosen motion" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Chosen character" })).toHaveCount(0);

  await open(page, `/g/${id}`);
  await page.getByRole("link", { name: "Same character, another motion" }).click();
  await expect(page).toHaveURL(/\/\?character=/);
  expect(searchOf(page)).toEqual({ character: characterId });
  await expect(page.getByRole("group", { name: "Chosen character" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Chosen motion" })).toHaveCount(0);
});
