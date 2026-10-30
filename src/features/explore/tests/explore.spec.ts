import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

import { expect, type Page, test } from "@playwright/test";

import { addPrerenderedTakes, count, open, seededResult } from "../../../../tests/e2e/session.ts";

// Explore as a visitor without the access code sees it, on the dead-port server: nothing here
// may submit a job.
test.use({ storageState: { cookies: [], origins: [] } });

const examples = (page: Page) => page.getByRole("list", { name: "Takes" });

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

// A fresh installation: the e2e database as seeded (`tests/e2e/seed.ts`), no take pre-rendered
// and none added by this test, as before anyone runs `scripts/prerender-samples.mjs`.
test("on an installation that has pre-rendered nothing, the gallery says why it is empty and offers Motion Transfer, on a desktop and a phone", async ({
  page,
}) => {
  expect(count("generations WHERE is_prerendered = 1")).toBe(0);

  for (const viewport of [
    { height: 800, width: 1280 },
    { height: 844, width: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await open(page, "/explore");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Finished takes, ready to remake",
    );
    await expect(page.getByRole("heading", { name: "No takes yet" })).toBeVisible();
    await expect(page.getByText("Sample takes show up here")).toBeVisible();
    await expect(page.getByText("scripts/prerender-samples.mjs")).toBeVisible();
    await expect(examples(page)).toHaveCount(0);
    expect(await scrollsSideways(page)).toBe(false);

    // On a phone the navigation is in the menu.
    const menu = page.getByRole("button", { name: "Open the menu" });
    const phone = await menu.isVisible();

    if (phone) {
      await menu.click();
    }

    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Explore" }),
    ).toHaveAttribute("aria-current", "page");

    if (phone) {
      await page.getByRole("button", { name: "Close the menu" }).click();
    }
  }

  // The next step works: it opens the wizard on motion selection.
  await page.getByRole("link", { name: "Start a shot" }).click();
  await expect(page).toHaveURL(/\/motionTransfer(\?step=motion)?$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pick a motion");
});

test.describe("with the pre-rendered sample takes", () => {
  let prerendered: ReturnType<typeof addPrerenderedTakes>;

  test.beforeAll(() => {
    prerendered = addPrerenderedTakes();

    // A second look, so the gallery has a look to filter by: the last take's.
    const writable = new DatabaseSync(process.env.E2E_DATABASE_PATH ?? "");

    try {
      writable
        .prepare(
          "UPDATE generations SET recipe = json_set(recipe, '$.params.prompt', ?) WHERE id = ?",
        )
        .run("A plain studio look.", prerendered.takes.at(-1)?.id ?? "");
    } finally {
      writable.close();
    }
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
    await expect(page.getByRole("status")).toHaveText(`${prerendered.takes.length} takes`);
    await expect(examples(page).locator(`a[href="/explore/${seededSlug}"]`)).toHaveCount(0);

    for (const take of prerendered.takes) {
      await expect(
        examples(page).getByRole("link", {
          name: new RegExp(`^${take.title} performs Street dance`),
        }),
      ).toHaveAttribute("href", `/explore/${take.shareSlug}`);
    }

    // Every take shown says it is generated.
    await expect(examples(page).getByText("AI-generated", { exact: true })).toHaveCount(
      prerendered.takes.length,
    );

    // Filters: one motion and one look, each a toggle that keeps the URL.
    const motions = page.getByRole("radiogroup", { name: "Filter by motion" });

    await motions.getByRole("radio", { name: "Street dance" }).click();
    await expect(page).toHaveURL(/\/explore\?motion=street-dance$/);
    await expect(motions.getByRole("radio", { name: "Street dance" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(examples(page).getByRole("listitem")).toHaveCount(prerendered.takes.length);

    await page
      .getByRole("radiogroup", { name: "Filter by look" })
      .getByRole("radio", { name: "e2e seeded result" })
      .click();
    await expect(page).toHaveURL(/look=[0-9a-f]{12}/);
    await expect(examples(page).getByRole("listitem")).toHaveCount(prerendered.takes.length - 1);

    // A filter nothing matches has its own empty state.
    await open(page, "/explore?motion=moonwalk");
    await expect(page.getByRole("heading", { name: "No takes match" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(`0 of ${prerendered.takes.length} takes`);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(examples(page).getByRole("listitem")).toHaveCount(prerendered.takes.length);

    // An example's page: the sample clip beside the result, the recipe, and the rest of it folded.
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
      comparison.locator(
        `video[aria-label="AI-generated result: ${first.title} performs Street dance"]`,
      ),
    ).toHaveAttribute("src", /\/media\/[0-9a-f-]{36}\.mp4$/);

    // The take is tagged as generated; the source clip is not generated, so it is not.
    await expect(comparison.getByText("AI-generated", { exact: true })).toHaveCount(1);

    const panel = page.getByRole("complementary", { name: "The recipe" });

    await expect(panel).toContainText("Street dance");
    await expect(panel).toContainText(first.title);
    await expect(panel).toContainText("e2e seeded result");

    await panel.getByRole("button", { name: "Full recipe" }).click();

    const recipe = page.getByRole("definition");

    await expect(page.getByRole("term")).toHaveText([
      "Look",
      "Seed",
      "Size",
      "Workflow",
      "Models",
      "Rendered on",
    ]);
    await expect(recipe.nth(0)).toHaveText("e2e seeded result");
    await expect(recipe.nth(1)).toHaveText("1");
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
      "This take is no longer in Explore",
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
      .getByRole("radiogroup", { name: "Filter by motion" })
      .getByRole("radio", { name: "Street dance" });

    await streetDance.focus();
    await page.keyboard.press("Enter");
    await expect(streetDance).toHaveAttribute("aria-checked", "true");

    // Tab on from the filters to the first take.
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

    // The wizard opens at character selection with the take's motion, look and seed kept.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who performs it?");

    const search = Object.fromEntries(new URL(page.url()).searchParams);

    expect(search).toEqual({
      from: first.id,
      motion: seededResult().sourceAssetId,
      prompt: "e2e seeded result",
      seed: "1",
    });

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
    await expect(page.getByRole("status")).toHaveText("Loading the take…");
    await expect(page.getByRole("alert")).toContainText("This take didn't load");

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

  test("with the browser offline, opening an example shows its error with Try again, and Try again loads it once back online, on a first visit and after opening it before", async ({
    context,
    page,
  }) => {
    const [first] = prerendered.takes;

    if (!first) {
      throw new Error("No sample characters were seeded");
    }

    const card = examples(page).getByRole("link", { name: new RegExp(`^${first.title} performs`) });

    const heading = page.getByRole("heading", { level: 1 });

    // The app hydrated online; then the network goes away entirely, not one request.
    await page.setViewportSize({ height: 800, width: 1280 });
    await open(page, "/explore");

    for (const visit of ["first", "again"]) {
      await context.setOffline(true);
      await card.click();
      await expect(page.getByRole("alert"), `${visit} visit`).toContainText(
        "This take didn't load",
      );
      expect(page.url()).toBe(new URL(`/explore/${first.shareSlug}`, page.url()).href);

      // Still offline, Try again says the same; online, it loads the example in place.
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByRole("alert")).toContainText("This take didn't load");
      await context.setOffline(false);
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(heading).toHaveText(`${first.title} performs Street dance`);

      // Back to the gallery in the page, for the visit after one online.
      await page.goBack();
      await expect(heading).toHaveText("Finished takes, ready to remake");
    }
  });
});
