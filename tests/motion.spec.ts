import { expect, type Page, test } from "@playwright/test";

import { count, open, seededResult } from "./e2e/session.ts";

const upload = (page: Page) => page.getByLabel("Or upload your own clip");

const uploadStatus = (page: Page) => page.getByRole("status");

/** Holds every request to `url` until the returned function releases them. */
async function hold(page: Page, url: string) {
  let release = () => {};

  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(url, async (route) => {
    await released;
    // The page may have cancelled the request meanwhile.
    await route.continue().catch(() => {});
  });

  return release;
}

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
  await expect(uploadStatus(page)).toHaveAttribute("data-state", "ready");
  await expect(page).toHaveURL(/\?motion=[0-9a-f-]{36}$/);

  const firstEight = new URL(page.url()).searchParams.get("motion");

  // Another part: the start handle 1 s in, so the trim endpoint cuts 1–8 s.
  await upload(page).setInputFiles("tests/fixtures/long-12s.mp4");
  await expect(dialog).toBeVisible();

  const start = dialog.getByRole("slider", { name: "Trim start" });

  for (let step = 0; step < 10; step += 1) {
    await start.press("ArrowRight");
  }

  await expect(start).toHaveAttribute("aria-valuenow", "1000");
  await expect(dialog.getByRole("slider", { name: "Trim end" })).toHaveAttribute(
    "aria-valuenow",
    "8000",
  );
  await dialog.getByRole("button", { name: "Use this part" }).click();
  await expect(uploadStatus(page)).toHaveAttribute("data-state", "ready");

  const cut = new URL(page.url()).searchParams.get("motion");

  expect(cut).not.toBe(firstEight);
  expect(count(`assets WHERE id = '${cut}' AND abs(duration_ms - 7000) < 100`)).toBe(1);
  await expect(page.getByRole("group", { name: "Chosen motion" })).toBeVisible();
});

test("closing the trim dialog while it cuts cancels the cut, and its answer selects nothing", async ({
  page,
}) => {
  await open(page, "/");
  await page.getByRole("button", { name: "Street dance" }).click();
  await expect(page).toHaveURL(/\?motion=/);

  const sample = page.url();
  const release = await hold(page, "**/api/assets/*/trim");

  await upload(page).setInputFiles("tests/fixtures/long-12s.mp4");

  const dialog = page.getByRole("dialog", { name: "Trim your clip" });

  await dialog.getByRole("slider", { name: "Trim start" }).press("ArrowRight");

  const cutting = page.waitForRequest("**/api/assets/*/trim");

  await dialog.getByRole("button", { name: "Use this part" }).click();
  await cutting;
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  release();

  // An answer that still counted would have selected the cut by now.
  await page.waitForTimeout(1500);
  expect(page.url()).toBe(sample);
  await expect(page.getByRole("button", { name: "Street dance" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("leaving the page during an upload cancels it, and its answer never navigates", async ({
  page,
}) => {
  const { id } = seededResult();

  await open(page, `/g/${id}`);
  await page.getByRole("link", { name: "Same character, another motion" }).click();
  await expect(page).toHaveURL(/\?character=/);

  const release = await hold(page, "**/api/uploads");

  // A 3–8 s clip: ready as uploaded, so its answer would select it (and navigate) at once.
  await upload(page).setInputFiles("tests/fixtures/result-5s.mp4");
  await expect(uploadStatus(page)).toHaveAttribute("data-state", /^(uploading|probing)$/);
  await page.goBack();
  await expect(page).toHaveURL(`/g/${id}`);
  release();

  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(`/g/${id}`);
});

test("a 2 s clip is too short and stores nothing; an audio file has no video; picking a sample clears the refusal", async ({
  page,
}) => {
  await open(page, "/");

  const assets = count("assets");

  await upload(page).setInputFiles("tests/fixtures/short-2s.mp4");
  await expect(uploadStatus(page)).toHaveAttribute("data-reason", "too_short");
  expect(count("assets")).toBe(assets);

  await upload(page).setInputFiles("tests/fixtures/audio-only.m4a");
  await expect(uploadStatus(page)).toHaveAttribute("data-reason", "no_video");
  expect(count("assets")).toBe(assets);
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("button", { name: "Street dance" }).click();
  await expect(uploadStatus(page)).toHaveAttribute("data-state", "idle");
  await expect(uploadStatus(page)).toBeEmpty();
});

test("an upload over the rate limit says to wait and keeps the page as it was", async ({
  page,
}) => {
  await open(page, "/");

  // The guard's answer over the limit (`src/server/access.server.ts`): the e2e server's limit is
  // high enough for the whole run, so the page gets it here.
  await page.route("**/api/uploads", (route) =>
    route.fulfill({
      headers: { "Retry-After": "42" },
      json: {
        error: "Too many uploads. Try again in 42 s.",
        reason: "rate_limited",
        retry_after: 42,
      },
      status: 429,
    }),
  );

  await upload(page).setInputFiles("tests/fixtures/result-5s.mp4");
  await expect(uploadStatus(page)).toHaveAttribute("data-reason", "rate_limited");
  await expect(uploadStatus(page)).not.toBeEmpty();
  await expect(page).toHaveURL(/\/$/);
});

test("a motion id that names no clip falls back to none", async ({ page }) => {
  for (const motion of ["xyz", crypto.randomUUID()]) {
    await open(page, `/?motion=${motion}`);
    await expect(page.getByRole("button", { name: "Street dance" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByRole("group", { name: "Chosen motion" })).toHaveCount(0);
  }
});
