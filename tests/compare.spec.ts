import { expect, type Locator, test } from "@playwright/test";

import { open, seededResult } from "./e2e/session.ts";

/** Reads one property of a `<video>`. */
function read<K extends "currentTime" | "muted" | "paused">(video: Locator, property: K) {
  return video.evaluate((element: HTMLVideoElement, key) => element[key], property);
}

test("the result drives its source on one clock, both served in byte ranges", async ({ page }) => {
  const { id } = seededResult();
  const ranged = new Set<string>();

  page.on("response", (response) => {
    const { pathname } = new URL(response.url());

    if (response.status() === 206 && pathname.endsWith(".mp4")) {
      ranged.add(pathname);
    }
  });

  await open(page, `/g/${id}`);

  const result = page.locator('video[aria-label="Result"]');
  const source = page.locator('video[aria-label="Source motion"]');

  await expect(page.getByRole("slider", { name: "Swipe between source and result" })).toBeHidden();
  await expect(result).toHaveAttribute("poster", /^\/media\/[0-9a-f-]{36}\.jpg$/);
  // Only the result is heard: the source is muted.
  expect(await read(source, "muted")).toBe(true);
  expect(await read(result, "muted")).toBe(false);
  // The scrubber spans the result, whose metadata may load before React hydrates.
  const seek = page.getByRole("slider", { name: "Seek" });

  await expect.poll(async () => Number(await seek.getAttribute("aria-valuemax"))).toBeCloseTo(5, 0);

  await page.getByRole("button", { name: "Play" }).click();
  await expect
    .poll(async () => [await read(result, "paused"), await read(source, "paused")], {
      timeout: 500,
    })
    .toEqual([false, false]);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect.poll(() => read(source, "paused")).toBe(true);

  await result.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 2;
  });
  await expect
    .poll(async () => Math.abs((await read(source, "currentTime")) - 2))
    .toBeLessThan(0.1);

  // The one scrubber moves the result, and the source with it.
  await seek.press("Home");
  await expect.poll(() => read(result, "currentTime")).toBe(0);
  await expect.poll(() => read(source, "currentTime")).toBe(0);

  // At the result's end both stop, and Replay starts both again from the top.
  await result.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 4.5;
  });
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Replay" })).toBeVisible({ timeout: 5000 });
  expect(await read(source, "paused")).toBe(true);
  await page.getByRole("button", { name: "Replay" }).click();
  await expect
    .poll(async () => [await read(result, "paused"), await read(source, "paused")])
    .toEqual([false, false]);
  expect(await read(result, "currentTime")).toBeLessThan(2);

  expect(ranged.size, "206 responses for the result and the source").toBe(2);
});

test("a narrow screen shows one picture with a swipe slider that follows the pointer", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await open(page, `/g/${seededResult().id}`);

  const slider = page.getByRole("slider", { name: "Swipe between source and result" });
  const box = await slider.boundingBox();

  if (!box) {
    throw new Error("The swipe slider has no box");
  }

  await expect(slider).toHaveAttribute("aria-valuenow", "50");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(slider).toHaveAttribute("aria-valuenow", "25");
  expect(
    await page
      .locator("figure", { has: page.locator('video[aria-label="Result"]') })
      .evaluate((figure) => getComputedStyle(figure).clipPath),
  ).toBe("inset(0px 0px 0px 25%)");
});
