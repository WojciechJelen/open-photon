import { expect, type Page, test } from "@playwright/test";

import { addPrerenderedTakes, open } from "../../../../tests/e2e/session.ts";

// What a visitor without the access code sees.
test.use({ storageState: { cookies: [], origins: [] } });

let prerendered: ReturnType<typeof addPrerenderedTakes>;

test.beforeAll(() => {
  prerendered = addPrerenderedTakes();
});

test.afterAll(() => prerendered.remove());

const wall = (page: Page) => page.getByRole("region", { name: "Made here" });

const tiles = (page: Page) => wall(page).getByRole("list").getByRole("link");

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

  await expect(tiles(page)).toHaveCount(prerendered.takes.length);
  await expect(wall(page).getByText("AI-generated")).toHaveCount(prerendered.takes.length);
  await expect(wall(page).getByRole("link", { name: "Explore all takes" })).toHaveAttribute(
    "href",
    "/explore",
  );

  for (const take of prerendered.takes) {
    await expect(
      wall(page).getByRole("link", { name: `${take.title} performs Street dance: open the take` }),
    ).toHaveAttribute("href", `/r/${take.shareSlug}`);
  }

  const [first] = prerendered.takes;

  if (!first) {
    throw new Error("No sample characters were seeded");
  }

  const name = `${first.title} performs Street dance`;

  // The wall closes the page: its tiles stay unloaded until they are scrolled to.
  expect(await playing(page, name)).toBe(false);

  await wall(page).getByRole("link", { name }).scrollIntoViewIfNeeded();
  await expect.poll(() => playing(page, name)).toBe(true);

  await wall(page)
    .getByRole("link", { name: `${first.title} performs Street dance` })
    .click();
  await expect(page).toHaveURL(`/r/${first.shareSlug}`);
  await expect(page.locator("video").first()).toBeVisible();
});

test("an output says it is AI-generated on the picture, a tool's illustration in its alt text", async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await open(page, "/");

  const tools = page.locator("#tools");

  await expect(page.locator("main section").first().getByText("AI-generated")).toBeVisible();
  await expect(tools.getByRole("figure").filter({ hasText: "Your take" })).toContainText(
    "AI-generated",
  );
  await expect(tools.getByRole("img", { name: /, an AI-generated image$/ })).toHaveCount(1);

  for (const name of ["Image tools", "Video tools"]) {
    const list = page.getByRole("list", { name });

    await expect(list.getByText("AI-generated")).toHaveCount(0);
    await expect(list.getByRole("img", { name: /AI-generated/ })).toHaveCount(
      await list.getByRole("listitem").count(),
    );
  }
});

test("asked for less motion, the hero's take rests on the moment its source does", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ height: 900, width: 1440 });
  await open(page, "/");

  const clips = page.locator("main section").first().locator("video");

  await expect(clips).toHaveCount(2);
  await expect
    .poll(() =>
      clips.evaluateAll((videos: HTMLVideoElement[]) =>
        videos.map(({ currentTime, paused }) => [paused, currentTime]),
      ),
    )
    .toEqual([
      [true, 2.4],
      [true, 2.4],
    ]);
});

test("at 390 px the wall is four takes without sideways scroll, and a tile plays once scrolled to", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await open(page, "/");

  const last = prerendered.takes.at(3);

  if (!last) {
    throw new Error("No sample characters were seeded");
  }

  const name = `${last.title} performs Street dance`;

  await expect(tiles(page)).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await playing(page, name)).toBe(false);

  await wall(page).getByRole("link", { name }).scrollIntoViewIfNeeded();
  await expect.poll(() => playing(page, name)).toBe(true);
});
