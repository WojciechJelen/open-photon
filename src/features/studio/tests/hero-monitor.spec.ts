import { expect, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";

const split = /Move the split/;

test("the hero's split moves by keyboard and pointer, and the frame stays where it is", async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await open(page, "/");

  const slider = page.getByRole("slider", { name: split });
  const before = await slider.boundingBox();

  await expect(slider).toHaveAttribute("aria-valuenow", "50");

  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", "45");
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "10");
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuenow", "90");

  if (!before) {
    throw new Error("The split has no box");
  }

  await page.mouse.click(before.x + before.width / 4, before.y + before.height / 2);
  await expect(slider).toHaveAttribute("aria-valuenow", "25");
  expect(await slider.boundingBox()).toEqual(before);

  // Only the primary button drags.
  await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2, {
    button: "right",
  });
  await expect(slider).toHaveAttribute("aria-valuenow", "25");
});

// The seeded database has no sample take: what needs one is in `result-wall.spec.ts`, which adds
// them. Nothing here depends on it either way.
test("the monitor's tags give way to a narrow side", async ({ page }) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await open(page, "/");

  const hero = page.locator("main section").first();
  const slider = page.getByRole("slider", { name: split });

  const opacity = (text: string) =>
    hero
      .getByText(text, { exact: true })
      .locator("..")
      .evaluate((tag) => getComputedStyle(tag).opacity);

  await slider.focus();
  await page.keyboard.press("End");

  await expect.poll(() => opacity("Your character")).toBe("0");

  await page.keyboard.press("Home");

  await expect.poll(() => opacity("Source")).toBe("0");
  await expect.poll(() => opacity("Your character")).toBe("1");
});

test("the laptop's first screen holds the whole monitor", async ({ page }) => {
  await page.setViewportSize({ height: 720, width: 1280 });
  await open(page, "/");

  const box = await page.getByRole("slider", { name: split }).boundingBox();

  expect((box?.y ?? 720) + (box?.height ?? 0)).toBeLessThanOrEqual(720);
});

test("asked for less motion, the monitor's clips hold still on one moment", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ height: 900, width: 1440 });
  await open(page, "/");

  const source = page.locator("main section").first().locator("video").first();

  await expect
    .poll(() =>
      source.evaluate(({ currentTime, paused }: HTMLVideoElement) => [paused, currentTime]),
    )
    .toEqual([true, 2.4]);
});

test("a phone shows the split without its handle", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await open(page, "/");

  await expect(page.getByRole("slider", { name: split })).toHaveCount(0);
  await expect(page.locator("main video").first()).toBeVisible();
});
