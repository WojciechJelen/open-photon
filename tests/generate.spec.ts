import { expect, type Page, test } from "@playwright/test";

import { generationSchema } from "../src/shared/contracts.ts";
import {
  addQueuedGeneration,
  addTextOnlyGeneration,
  cancelWaiting,
  count,
  finishGeneration,
  open,
  queuedGenerationId,
  seededResult,
  takeLastInFlightPlace,
} from "./e2e/session.ts";

/** Records every `POST /api/generate`, the request that submits to Comfy. */
function generatePosts(page: Page) {
  const posts: string[] = [];

  page.on("request", (sent) => {
    if (sent.method() === "POST" && new URL(sent.url()).pathname === "/api/generate") {
      posts.push(sent.url());
    }
  });

  return posts;
}

declare global {
  interface Window {
    /** The page's `EventSource`s not closed yet (`countStreams`). */
    streams: number;
  }
}

/**
 * Counts the page's open `EventSource`s, from before its scripts run. Open ones, not created
 * ones: React's development mode mounts each effect twice, closing the first stream at once.
 */
async function countStreams(page: Page) {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;

    window.streams = 0;
    window.EventSource = class extends NativeEventSource {
      constructor(...parameters: ConstructorParameters<typeof EventSource>) {
        super(...parameters);
        window.streams += 1;
      }

      override close() {
        if (this.readyState !== NativeEventSource.CLOSED) {
          window.streams -= 1;
        }

        super.close();
      }
    };
  });

  return () => page.evaluate(() => window.streams);
}

const status = (page: Page) => page.getByRole("status", { name: "Generation status" });

/** The Direct step with the sample motion and the first sample character picked. */
const directStep = () => {
  const { characterId, sourceAssetId } = seededResult();

  return `/motionTransfer?step=direct&motion=${sourceAssetId}&character=${characterId}`;
};

test("an invalid form shows why and never calls generate", async ({ page }) => {
  const posts = generatePosts(page);
  const generations = count("generations");

  await open(page, directStep());
  await page.getByRole("button", { name: /Advanced/ }).click();

  const problems = page
    .getByRole("alert", { name: "Problems with the form" })
    .getByRole("listitem");

  const seed = page.getByLabel("Seed", { exact: true });
  const look = page.getByLabel("Look");

  await seed.fill("-1");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(problems).toHaveCount(1);
  await expect(seed).toHaveAttribute("aria-invalid", "true");
  await seed.fill("7");
  await look.fill("x".repeat(501));
  await expect(page.getByText("501 / 500")).toBeVisible();
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(look).toHaveAttribute("aria-invalid", "true");
  await expect(seed).toHaveAttribute("aria-invalid", "false");
  await expect(problems).toHaveCount(1);

  // A submit that slipped through would have fired by now.
  await page.waitForTimeout(1500);
  expect(posts, "unexpected POST /api/generate").toEqual([]);
  expect(count("generations")).toBe(generations);
});

test("with Comfy at a dead port, Generate opens a failed generation with the reason, and Retry opens its failed child", async ({
  page,
}) => {
  await open(page, "/motionTransfer");
  await page.getByRole("button", { name: "Street dance" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Arthur" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const { character, motion } = Object.fromEntries(new URL(page.url()).searchParams);

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);

  const parent = page.url().split("/g/")[1] ?? "";

  await expect(status(page)).toHaveAttribute("data-status", "failed");
  // The reason is the one the row stores, in plain words and as stored.
  expect(count(`generations WHERE id = '${parent}' AND error_message IS NOT NULL`)).toBe(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Comfy couldn't be reached");
  await expect(page.getByRole("alert")).toContainText("provider_unreachable");
  await expect(page.getByText(/remaining|left|ETA/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Retry with a new seed" }).click();
  await expect(page).not.toHaveURL(new RegExp(parent));
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
  await expect(status(page)).toHaveAttribute("data-status", "failed");
  expect(count(`generations WHERE parent_id = '${parent}'`)).toBe(1);

  // The child links back to its parent, and to the same picks in the wizard.
  await expect(page.getByRole("link", { name: "the earlier generation" })).toHaveAttribute(
    "href",
    `/g/${parent}`,
  );
  await page.getByRole("link", { name: "Change the shot" }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/motionTransfer" &&
      url.searchParams.get("step") === "direct" &&
      url.searchParams.get("motion") === motion &&
      url.searchParams.get("character") === character,
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Direct the shot");
});

test("Change the shot on a failed take opens Direct with its look and seed, to tweak and retry", async ({
  page,
}) => {
  const look = "Red jacket.\n\nRain  on glass.";

  await open(page, "/motionTransfer");
  await page.getByRole("button", { name: "Street dance" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Kenji" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Look").fill(look);
  await page.getByRole("button", { name: /Advanced/ }).click();
  await page.getByLabel("Seed", { exact: true }).fill("777");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(status(page)).toHaveAttribute("data-status", "failed");

  const take = page.url().split("/g/")[1] ?? "";

  await page.getByRole("link", { name: "Change the shot" }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("from") === take && url.searchParams.get("step") === "direct",
  );

  // The direction is the take's, exactly, and survives a reload.
  for (const reload of [false, true]) {
    if (reload) {
      await page.reload();
      await page.locator("html[data-hydrated]").waitFor();
    }

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Direct the shot");
    await expect(page.getByLabel("Look")).toHaveValue(look);
    await expect(page.getByRole("button", { name: /Advanced/ })).toContainText("Seed: 777");
  }

  const slate = page.getByRole("complementary", { name: "Your shot" });

  await expect(slate).toContainText("Kenji");
});

test("with every place in flight taken, Generate puts the take in line and its page shows its place", async ({
  page,
}) => {
  const release = takeLastInFlightPlace();
  let waiting = "";

  try {
    await open(page, directStep());

    const rows = count("generations");

    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);

    waiting = page.url().split("/g/")[1] ?? "";

    await expect(status(page)).toHaveAttribute("data-status", "waiting");
    await expect(status(page)).toContainText("In line · #1");
    await expect(
      page.getByRole("list", { name: "Render stages" }).locator('[aria-current="step"]'),
    ).toContainText("Number 1 in line for a free rendering slot");
    expect(count("generations")).toBe(rows + 1);
  } finally {
    // Out of line before the place is given back, so the server's dispatcher never sends it.
    cancelWaiting(waiting);
    release();
  }
});

test("a running generation follows its event stream, and opens it again after a reload", async ({
  page,
  request,
}) => {
  const streams = await countStreams(page);
  const id = queuedGenerationId();
  const stored = generationSchema.parse(await (await request.get(`/api/generations/${id}`)).json());
  const progress = page.getByRole("progressbar", { name: "Render progress" });
  let reported = 40;

  const notice = page.getByRole("status", { name: "Comfy connection" });

  // The real stream with Comfy at the dead port: the stored status, marked as the last known.
  await open(page, `/g/${id}`);
  await expect(notice).toBeVisible();
  await expect(status(page)).toHaveAttribute("data-status", "queued");
  // The named stages, the current one marked; and the page's own link, since leaving is safe.
  await expect(
    page.getByRole("list", { name: "Render stages" }).locator('[aria-current="step"]'),
  ).toContainText("Queued");
  await expect(page.getByLabel("Link to this render")).toHaveValue(new RegExp(`/g/${id}$`));
  expect(await streams()).toBe(1);

  // The stream as Comfy would drive it: the stored generation, running at `reported` percent.
  await page.route(`**/api/generations/${id}/events`, (route) =>
    route.fulfill({
      body: `data: ${JSON.stringify({
        generation: { ...stored, progress: reported, status: "running" },
        kind: "snapshot",
      })}\n\n`,
      contentType: "text/event-stream",
    }),
  );

  await page.reload();
  await expect(status(page)).toHaveAttribute("data-status", "running");
  await expect(progress).toHaveAttribute("aria-valuenow", "40");
  await expect(notice).toHaveCount(0);
  expect(await streams()).toBe(1);

  // The page loads the stored (queued) generation again, then its new stream reports.
  reported = 55;
  await page.reload();
  await expect(progress).toHaveAttribute("aria-valuenow", "55");
  expect(await streams()).toBe(1);
});

test("a take the stream reports done shows its result, even when the first reload comes too early", async ({
  page,
  request,
}) => {
  const { id, remove } = addQueuedGeneration();

  try {
    const stored = generationSchema.parse(
      await (await request.get(`/api/generations/${id}`)).json(),
    );

    const { finalAssetId } = seededResult();

    // The stream says done before the stored row does, as when Comfy's last event outruns the
    // commit: the page's first reloads find no result yet.
    await page.route(`**/api/generations/${id}/events`, (route) =>
      route.fulfill({
        body: `data: ${JSON.stringify({
          generation: { ...stored, final_asset_id: finalAssetId, progress: 100, status: "done" },
          kind: "snapshot",
        })}\n\n`,
        contentType: "text/event-stream",
      }),
    );

    await open(page, `/g/${id}`);
    await expect(status(page)).toHaveAttribute("data-status", "finalizing");
    await page.waitForTimeout(2500);
    await expect(status(page)).toHaveAttribute("data-status", "finalizing");

    finishGeneration(id);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your shot is ready", {
      timeout: 10_000,
    });
    await expect(page.locator('video[aria-label="Result"]')).toHaveAttribute(
      "src",
      `/media/${finalAssetId}.mp4`,
    );
    await expect(page.locator('video[aria-label="Result"]')).toHaveAttribute(
      "poster",
      /^\/media\/[0-9a-f-]{36}\.jpg$/,
    );
  } finally {
    remove();
  }
});

test("a finished generation opens no event stream", async ({ page }) => {
  const streams = await countStreams(page);

  await open(page, `/g/${seededResult().id}`);
  await expect(status(page)).toHaveAttribute("data-status", "done");
  expect(await streams()).toBe(0);
});

test("an unknown generation is a not-found page", async ({ page }) => {
  const response = await page.goto(`/g/${crypto.randomUUID()}`);

  expect(response?.status()).toBe(404);
  await expect(status(page)).toHaveCount(0);
});

test("a done generation whose outputs are all text is final on its page: no Finishing, no polling, no text", async ({
  page,
  request,
}) => {
  const { id, remove, text } = addTextOnlyGeneration();

  try {
    // Its API shows the text inline, to a session; it has no share page.
    const stored = generationSchema.parse(
      await (await request.get(`/api/generations/${id}`)).json(),
    );

    expect(stored.status).toBe("done");
    expect(stored.share_slug).toBeNull();
    expect(stored.outputs).toEqual([{ media: "text", name: "caption", text }]);

    const reads: string[] = [];

    page.on("request", (sent) => {
      if (new URL(sent.url()).pathname.startsWith("/_serverFn/")) {
        reads.push(sent.url());
      }
    });

    await open(page, `/g/${id}`);
    await expect(status(page)).toHaveAttribute("data-status", "done");
    await expect(
      page.getByText("This generation has no image or video to show here."),
    ).toBeVisible();
    // Neither Motion Transfer's title nor an image's: it shows no file.
    await expect(page).toHaveTitle("Generation · Open Photon");
    await expect(page.getByText(text)).toHaveCount(0);

    // Done is final: the page never reloads its result.
    await page.waitForTimeout(4500);
    await expect(status(page)).toHaveAttribute("data-status", "done");
    expect(reads, "the page reloaded a final result").toEqual([]);
  } finally {
    remove();
  }
});
