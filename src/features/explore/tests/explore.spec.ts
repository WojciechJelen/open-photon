import { setTimeout as sleep } from "node:timers/promises";

import { expect, type Page, test } from "@playwright/test";

import { addPrerenderedTakes, count, open, seededResult } from "../../../../tests/e2e/session.ts";

// Explore as a visitor without the access code sees it, on the dead-port server: nothing here
// may submit a job.
test.use({ storageState: { cookies: [], origins: [] } });

const examples = (page: Page) => page.getByRole("list", { name: "Examples" });

/** Whether the page scrolls sideways. */
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

/** Fails the test on any request that could start, change or pay for a generation. */
function refuseWrites(page: Page) {
  const writes: string[] = [];

  page.on("request", (request) => {
    if (request.method() !== "GET" && !request.url().includes("/_serverFn/")) {
      writes.push(`${request.method()} ${request.url()}`);
    }
  });

  return writes;
}

test("with no curated takes, the gallery says so and offers Motion Transfer", async ({ page }) => {
  await open(page, "/explore");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Finished takes, ready to remake",
  );
  await expect(page.getByRole("heading", { name: "No examples yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Motion Transfer" })).toHaveAttribute(
    "href",
    "/motionTransfer",
  );
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Explore" }),
  ).toHaveAttribute("aria-current", "page");
});

test.describe("with the pre-rendered sample takes", () => {
  let prerendered: ReturnType<typeof addPrerenderedTakes>;

  test.beforeAll(() => {
    prerendered = addPrerenderedTakes();
  });

  test.afterAll(() => prerendered.remove());

  test("anyone browses, filters and inspects only the published examples, and loads their public media", async ({
    page,
  }) => {
    const writes = refuseWrites(page);
    const { id: seededId, shareSlug: seededSlug, sourceAssetId } = seededResult();

    await page.setViewportSize({ height: 800, width: 1280 });
    await open(page, "/explore");

    // Every pre-rendered take, and not the seeded take, which is published but not curated.
    await expect(examples(page).getByRole("listitem")).toHaveCount(prerendered.takes.length);
    await expect(page.getByRole("status")).toHaveText(`${prerendered.takes.length} examples`);
    await expect(examples(page).locator(`a[href="/explore/${seededSlug}"]`)).toHaveCount(0);

    for (const take of prerendered.takes) {
      await expect(
        examples(page).getByRole("link", {
          name: new RegExp(`^${take.title} performs Street dance`),
        }),
      ).toHaveAttribute("href", `/explore/${take.shareSlug}`);
    }

    // Filters: one motion and one look, each a toggle that keeps the URL.
    const motions = page.getByRole("group", { name: "Filter by motion" });

    await motions.getByRole("button", { name: "Street dance" }).click();
    await expect(page).toHaveURL(/\/explore\?motion=street-dance$/);
    await expect(motions.getByRole("button", { name: "Street dance" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(examples(page).getByRole("listitem")).toHaveCount(prerendered.takes.length);

    await page
      .getByRole("group", { name: "Filter by look" })
      .getByRole("button", { name: "e2e seeded result" })
      .click();
    await expect(page).toHaveURL(/look=[0-9a-f]{12}/);
    await expect(examples(page).getByRole("listitem")).toHaveCount(prerendered.takes.length);

    // A filter nothing matches has its own empty state.
    await open(page, "/explore?motion=moonwalk");
    await expect(
      page.getByRole("heading", { name: "No example matches these filters" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(`0 of ${prerendered.takes.length} examples`);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(examples(page).getByRole("listitem")).toHaveCount(prerendered.takes.length);

    // An example's page: the sample clip beside the result, and the recipe in words.
    const [first] = prerendered.takes;

    if (!first) {
      throw new Error("No sample characters were seeded");
    }

    await examples(page)
      .getByRole("link", { name: new RegExp(`^${first.title} performs`) })
      .click();
    await expect(page).toHaveURL(`/explore/${first.shareSlug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `${first.title} performs Street dance`,
    );

    const comparison = page.getByRole("region", { name: "Source and result" });
    const source = comparison.locator('video[aria-label="Source motion: Street dance"]');

    await expect(source).toHaveAttribute("src", `/media/${sourceAssetId}.mp4`);
    await expect(
      comparison.locator(`video[aria-label="Result: ${first.title} performs Street dance"]`),
    ).toHaveAttribute("src", /\/media\/[0-9a-f-]{36}\.mp4$/);

    const recipe = page.getByRole("definition");

    await expect(page.getByRole("term")).toHaveText([
      "Motion",
      "Character",
      "Look",
      "Seed",
      "Size",
      "Workflow",
      "Models",
      "Rendered on",
    ]);
    await expect(recipe.nth(2)).toHaveText("e2e seeded result");
    await expect(recipe.nth(3)).toHaveText("1");
    await expect(page.getByRole("link", { name: "Share page" })).toHaveAttribute(
      "href",
      new URL(`/r/${first.shareSlug}`, page.url()).href,
    );

    // Every file the page shows, and its recipe, load without the code.
    const files = await page
      .locator("main video[src], main img[src]")
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("src") ?? ""));

    expect(files.length).toBeGreaterThanOrEqual(3);

    for (const file of [...files, `/api/generations/${first.id}/recipe.json`]) {
      expect((await page.request.get(file)).status(), file).toBe(200);
    }

    // The seeded take is published but not curated: no Explore page for it.
    await open(page, `/explore/${seededSlug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This example is no longer in Explore",
    );
    await page.getByRole("link", { name: "Browse Explore" }).click();
    await expect(examples(page).getByRole("listitem")).toHaveCount(prerendered.takes.length);
    expect(seededId).not.toBe(first.id);
    expect(writes).toEqual([]);
  });

  test("by keyboard alone a visitor filters, opens an example and reaches character selection with its motion and look", async ({
    page,
  }) => {
    const writes = refuseWrites(page);
    const generations = count("generations");
    const [first] = prerendered.takes;

    if (!first) {
      throw new Error("No sample characters were seeded");
    }

    await page.setViewportSize({ height: 800, width: 1280 });
    await open(page, "/explore");

    const streetDance = page
      .getByRole("group", { name: "Filter by motion" })
      .getByRole("button", { name: "Street dance" });

    await streetDance.focus();
    await page.keyboard.press("Enter");
    await expect(streetDance).toHaveAttribute("aria-pressed", "true");

    // Tab on from the filters to the first example, then to its remake action.
    const card = examples(page).getByRole("link", { name: new RegExp(`^${first.title} performs`) });

    for (
      let step = 0;
      step < 10 && !(await card.evaluate((link) => link === document.activeElement));
      step += 1
    ) {
      await page.keyboard.press("Tab");
    }

    await expect(card).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/explore/${first.shareSlug}`);

    const remake = page.getByRole("link", { exact: true, name: "Make this with my character" });

    await remake.focus();
    await expect(remake).toBeFocused();
    await page.keyboard.press("Enter");

    // The wizard opens at character selection with the take's motion and look kept.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who performs it?");

    const search = Object.fromEntries(new URL(page.url()).searchParams);

    expect(search).toEqual({ from: first.id, motion: seededResult().sourceAssetId });

    const slate = page.getByRole("complementary", { name: "Your shot" });

    await expect(slate).toContainText("Street dance");
    await expect(slate).toContainText("e2e seeded result");

    // Browsing and opening the remake started nothing and paid for nothing.
    expect(count("generations")).toBe(generations);
    expect(writes).toEqual([]);
  });

  test("at 390 px the gallery and an example fit the screen, and the remake action is in reach", async ({
    page,
  }) => {
    const [first] = prerendered.takes;

    if (!first) {
      throw new Error("No sample characters were seeded");
    }

    await page.setViewportSize({ height: 844, width: 390 });
    await open(page, "/explore");
    await expect(examples(page).getByRole("listitem")).toHaveCount(prerendered.takes.length);
    expect(await scrollsSideways(page)).toBe(false);

    // Each card's remake action stays inside its card (it wraps rather than overflows).
    const overflowing = await examples(page)
      .getByRole("listitem")
      .evaluateAll(
        (cards) =>
          cards.filter((card) => {
            const action = card.querySelector('a[href^="/motionTransfer"]');
            const box = action?.getBoundingClientRect();

            return !box || box.right > card.getBoundingClientRect().right + 0.5;
          }).length,
      );

    expect(overflowing).toBe(0);

    await open(page, `/explore/${first.shareSlug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);

    const remake = page.getByRole("link", { exact: true, name: "Make this with my character" });

    await remake.scrollIntoViewIfNeeded();
    await expect(remake).toBeInViewport();
  });

  test("while an example loads its page says so, a failed load offers Try again, and a missing result falls back to its poster", async ({
    page,
  }) => {
    const [first] = prerendered.takes;

    if (!first) {
      throw new Error("No sample characters were seeded");
    }

    await page.setViewportSize({ height: 800, width: 1280 });
    await open(page, "/explore");

    // The next server call is slow, then fails.
    let failing = true;

    await page.route("**/_serverFn/**", async (route) => {
      if (!failing) {
        return route.continue();
      }

      await sleep(1000);

      return route.abort();
    });

    await examples(page)
      .getByRole("link", { name: new RegExp(`^${first.title} performs`) })
      .click();
    await expect(page.getByRole("status")).toHaveText("Loading the example…");
    await expect(page.getByRole("alert")).toContainText("This example could not be loaded");

    failing = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      `${first.title} performs Street dance`,
    );

    // A result file that does not load: the poster stands in, and the page stays usable.
    await page.route("**/media/*.mp4", (route) => route.fulfill({ status: 404 }));
    await open(page, "/explore");

    const tile = examples(page).getByRole("listitem").first();

    await expect(tile.locator("img")).toHaveAttribute("src", /\/media\/[0-9a-f-]{36}\.jpg$/);
    await expect(tile.locator("video")).toHaveCount(0);
    await expect(tile.getByRole("link", { name: /Make this with my character/ })).toBeVisible();
  });
});
