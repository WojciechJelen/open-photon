import { expect, type Page, test } from "@playwright/test";

import { addPrerenderedTakes, open } from "../../../../tests/e2e/session.ts";

// What a visitor without the access code sees.
test.use({ storageState: { cookies: [], origins: [] } });

let prerendered: ReturnType<typeof addPrerenderedTakes>;

test.beforeAll(() => {
  prerendered = addPrerenderedTakes();
});

test.afterAll(() => prerendered.remove());

const wall = (page: Page) => page.getByRole("region", { name: "Sample takes" });

/** Whether the tile's video has its source and is playing. */
const playing = (page: Page, name: string) =>
  wall(page)
    .getByRole("link", { name })
    .locator("video")
    .evaluate((video: HTMLVideoElement) => Boolean(video.currentSrc) && !video.paused);

test("the home page's result wall loops every pre-rendered take and opens its public share page", async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 1280 });
  await open(page, "/");

  const links = wall(page).getByRole("link");

  await expect(links).toHaveCount(prerendered.takes.length);

  for (const take of prerendered.takes) {
    await expect(
      wall(page).getByRole("link", { name: `${take.title} performs Street dance: open the take` }),
    ).toHaveAttribute("href", `/r/${take.shareSlug}`);
  }

  // The whole wall is above the fold.
  for (const link of await links.all()) {
    const box = await link.boundingBox();

    expect((box?.y ?? Number.POSITIVE_INFINITY) + (box?.height ?? 0)).toBeLessThanOrEqual(800);
  }

  const [first] = prerendered.takes;

  if (!first) {
    throw new Error("No sample characters were seeded");
  }

  await expect.poll(() => playing(page, `${first.title} performs Street dance`)).toBe(true);

  await wall(page)
    .getByRole("link", { name: `${first.title} performs Street dance` })
    .click();
  await expect(page).toHaveURL(`/r/${first.shareSlug}`);
  await expect(page.locator("video").first()).toBeVisible();
});

test("at 390 px the wall is a scrolling grid without sideways scroll, and a tile plays once scrolled to", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await open(page, "/");

  const last = prerendered.takes.at(-1);

  if (!last) {
    throw new Error("No sample characters were seeded");
  }

  const name = `${last.title} performs Street dance`;

  await expect(wall(page).getByRole("link")).toHaveCount(prerendered.takes.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await playing(page, name)).toBe(false);

  await wall(page).getByRole("link", { name }).scrollIntoViewIfNeeded();
  await expect.poll(() => playing(page, name)).toBe(true);
});
