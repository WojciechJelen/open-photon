import { expect, type Page, test } from "@playwright/test";

import { count, open, signIn } from "./e2e/session.ts";

test.beforeEach(({ page }) => signIn(page));

const upload = (page: Page) => page.getByLabel("Or upload your own clip");

const uploadStatus = (page: Page) => page.getByRole("status");

test("a sample motion plays as a muted loop, and picking it names its clip in the URL", async ({
  page,
}) => {
  await open(page, "/");

  const preview = page.getByRole("list", { name: "Sample motions" }).locator("video").first();

  await expect
    .poll(() => preview.evaluate((video: HTMLVideoElement) => [video.muted, video.loop]))
    .toEqual([true, true]);

  await page.getByRole("button", { name: "Street dance" }).click();
  await expect(page).toHaveURL(/\?motion=[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { name: "Street dance" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("group", { name: "Chosen motion" })).toBeVisible();
});

test("a clip over 8 s opens the trim dialog; its first 8 s or another part become ready", async ({
  page,
}) => {
  await open(page, "/");
  await upload(page).setInputFiles("tests/fixtures/long-12s.mp4");

  const dialog = page.getByRole("dialog", { name: "Trim your clip" });

  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Use this part" }).click();
  await expect(uploadStatus(page)).toHaveText("Ready");
  await expect(page).toHaveURL(/\?motion=[0-9a-f-]{36}$/);

  const firstEight = new URL(page.url()).searchParams.get("motion");

  // Another part: the start handle 1 s in, so the trim endpoint cuts 1–8 s.
  await upload(page).setInputFiles("tests/fixtures/long-12s.mp4");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("slider").first().focus();

  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press("ArrowRight");
  }

  await expect(dialog).toContainText("1.0 s to 8.0 s (7.0 s)");
  await dialog.getByRole("button", { name: "Use this part" }).click();
  await expect(uploadStatus(page)).toHaveText("Ready");
  expect(new URL(page.url()).searchParams.get("motion")).not.toBe(firstEight);
  await expect(page.getByRole("group", { name: "Chosen motion" })).toContainText("7.0 s");
});

test("a 2 s clip is too short and stores nothing; an audio file has no video", async ({ page }) => {
  await open(page, "/");

  const assets = count("assets");

  await upload(page).setInputFiles("tests/fixtures/short-2s.mp4");
  await expect(uploadStatus(page)).toHaveText(/^Too short: /);
  expect(count("assets")).toBe(assets);

  await upload(page).setInputFiles("tests/fixtures/audio-only.m4a");
  await expect(uploadStatus(page)).toHaveText(/^No video: /);
  expect(count("assets")).toBe(assets);
  await expect(page).toHaveURL(/\/$/);
});

test("a motion id that names no clip falls back to none", async ({ page }) => {
  for (const motion of ["xyz", crypto.randomUUID()]) {
    await open(page, `/?motion=${motion}`);
    await expect(page.getByText("No motion chosen yet.")).toBeVisible();
  }
});
