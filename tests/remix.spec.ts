import { expect, type Page, test } from "@playwright/test";

import { open, seededResult } from "./e2e/session.ts";

/** The current URL's search params, as one object. */
function searchOf(page: Page) {
  return Object.fromEntries(new URL(page.url()).searchParams);
}

test("Download saves the result's MP4 under a file name that says it is AI-generated", async ({
  page,
}) => {
  await open(page, `/g/${seededResult().id}`);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download MP4" }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^ai-generated-[0-9a-f]{8}\.mp4$/);
  expect(await download.failure()).toBeNull();
});

test("each remix opens the wizard with exactly one of motion and character kept, and the take's direction, at the step still to pick", async ({
  page,
}) => {
  const { characterId, id, sourceAssetId } = seededResult();
  const slate = page.getByRole("complementary", { name: "Your shot" });

  await open(page, `/g/${id}`);
  await page.getByRole("link", { name: /Same motion/ }).click();
  await expect(page).toHaveURL(/\/motionTransfer\?/);
  expect(searchOf(page)).toEqual({ from: id, motion: sourceAssetId, step: "character" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who performs it?");
  await expect(slate).toContainText("Street dance");
  // The take's direction comes along: its look is the seeded one.
  await expect(slate).toContainText("e2e seeded result");
  await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(0);

  await open(page, `/g/${id}`);
  await page.getByRole("link", { name: /Same character/ }).click();
  await expect(page).toHaveURL(/\/motionTransfer\?/);
  expect(searchOf(page)).toEqual({ character: characterId, from: id, step: "motion" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pick a motion");
  await expect(slate).toContainText("Placeholder blue");
  await expect(page.getByRole("button", { name: "Street dance" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
