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

  // Side by side on a wide screen: no swipe line.
  await expect(page.getByRole("radio", { name: "Side by side" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("slider", { name: "Swipe between source and result" })).toHaveCount(
    0,
  );
  await expect(result).toHaveAttribute("poster", /^\/media\/[0-9a-f-]{36}\.jpg$/);
  // The take is disclosed on the picture, whatever the board leaves out.
  await expect(page.getByRole("main").getByText("AI-generated", { exact: true })).toBeVisible();
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

  // Switching to Swipe moves the same two videos: playback goes on, and the swipe line appears.
  await page.getByRole("radio", { name: "Swipe" }).click();
  await expect(page.getByRole("slider", { name: "Swipe between source and result" })).toBeVisible();
  expect(await read(result, "paused")).toBe(false);
});

test("the transport mutes the result's sound and the swipe line moves from the keyboard", async ({
  page,
}) => {
  await open(page, `/g/${seededResult().id}`);

  const result = page.locator('video[aria-label="Result"]');

  await page.getByRole("button", { name: /^Mute/ }).click();
  await expect.poll(() => read(result, "muted")).toBe(true);
  await page.getByRole("button", { name: /^Unmute/ }).click();
  await expect.poll(() => read(result, "muted")).toBe(false);

  await page.getByRole("radio", { name: "Swipe" }).click();

  const swipe = page.getByRole("slider", { name: "Swipe between source and result" });

  await swipe.press("ArrowLeft");
  await expect(swipe).toHaveAttribute("aria-valuenow", "45");
  await swipe.press("End");
  await expect(swipe).toHaveAttribute("aria-valuenow", "100");
});

test("a narrow screen swipes by default, with a slider that follows the pointer", async ({
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

test("on a laptop screen the frames and the transport fit without scrolling, side by side and swiped", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 1440 });
  await open(page, `/g/${seededResult().id}`);

  for (const view of ["Side by side", "Swipe"]) {
    await page.getByRole("radio", { name: view }).click();

    const transport = await page.getByRole("slider", { name: "Seek" }).boundingBox();
    const play = await page.getByRole("button", { name: "Play" }).boundingBox();

    expect(transport, view).not.toBeNull();
    expect((play?.y ?? 0) + (play?.height ?? 0), view).toBeLessThanOrEqual(800);
    expect((transport?.y ?? 0) + (transport?.height ?? 0), view).toBeLessThanOrEqual(800);
  }
});

test("where the heading or the navigation wraps, the frames still leave the transport on screen", async ({
  page,
}) => {
  // 1024×768: the heading and the view toggle wrap beside the side panel; 375×812: the
  // navigation wraps onto a second row.
  for (const [width, height] of [
    [1024, 768],
    [375, 812],
  ] as const) {
    await page.setViewportSize({ height, width });
    await open(page, `/g/${seededResult().id}`);

    for (const view of ["Side by side", "Swipe"]) {
      await page.getByRole("radio", { name: view }).click();

      const label = `${view} at ${width}×${height}`;
      const transport = await page.getByRole("slider", { name: "Seek" }).boundingBox();
      const play = await page.getByRole("button", { name: "Play" }).boundingBox();

      expect(transport, label).not.toBeNull();
      expect((play?.y ?? 0) + (play?.height ?? 0), label).toBeLessThanOrEqual(height);
      expect((transport?.y ?? 0) + (transport?.height ?? 0), label).toBeLessThanOrEqual(height);
    }
  }
});
