import { expect, type Page, test } from "@playwright/test";

import { generationSchema } from "../src/features/genjutsu/contracts.ts";
import {
  count,
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

test("an invalid form shows why and never calls generate", async ({ page }) => {
  const posts = generatePosts(page);
  const generations = count("generations");

  await open(page, "/");
  await page.getByRole("button", { name: "Generate" }).click();

  const problems = page
    .getByRole("alert", { name: "Problems with the form" })
    .getByRole("listitem");

  // No motion and no character.
  await expect(problems).toHaveCount(2);

  await page.getByRole("button", { name: "Street dance" }).click();
  await page.getByRole("button", { name: "Placeholder blue" }).click();
  await expect(page).toHaveURL(/character=/);
  await page.getByRole("button", { name: "Advanced" }).click();

  const seed = page.getByLabel("Seed");
  const prompt = page.getByLabel("Appearance and background (optional)");

  await seed.fill("-1");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(problems).toHaveCount(1);
  await expect(seed).toHaveAttribute("aria-invalid", "true");
  await seed.fill("7");
  await prompt.fill("x".repeat(501));
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(prompt).toHaveAttribute("aria-invalid", "true");
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
  await open(page, "/");
  await page.getByRole("button", { name: "Street dance" }).click();
  await page.getByRole("button", { name: "Placeholder blue" }).click();
  await expect(page).toHaveURL(/character=/);

  const choices = new URL(page.url()).search;

  await page.getByLabel("Profile").check();
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);

  const parent = page.url().split("/g/")[1] ?? "";

  await expect(status(page)).toHaveAttribute("data-status", "failed");
  // The reason is the one the row stores.
  expect(count(`generations WHERE id = '${parent}' AND error_message IS NOT NULL`)).toBe(1);
  await expect(page.getByRole("alert")).not.toBeEmpty();
  await expect(page.getByText(/remaining|left|ETA/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Retry with a new seed" }).click();
  await expect(page).not.toHaveURL(new RegExp(parent));
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
  await expect(status(page)).toHaveAttribute("data-status", "failed");
  expect(count(`generations WHERE parent_id = '${parent}'`)).toBe(1);

  // The child links back to its parent, and to the same choices on `/`.
  await expect(page.getByRole("link", { name: "the earlier generation" })).toHaveAttribute(
    "href",
    `/g/${parent}`,
  );
  await page.getByRole("link", { name: "Change the motion or character" }).click();
  await expect(page).toHaveURL(`/${choices}`);
  await expect(page.getByRole("group", { name: "Chosen motion" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Chosen character" })).toBeVisible();
});

test("with every place in flight taken, Generate says the queue is full and starts nothing", async ({
  page,
}) => {
  const release = takeLastInFlightPlace();

  try {
    await open(page, "/");
    await page.getByRole("button", { name: "Street dance" }).click();
    await page.getByRole("button", { name: "Placeholder blue" }).click();
    await expect(page).toHaveURL(/character=/);

    const choices = page.url();
    const rows = count("generations");
    const generate = page.getByRole("button", { name: "Generate" });

    await generate.click();

    const refusal = page.getByRole("alert", { name: "Not started" });

    await expect(refusal).toHaveAttribute("data-reason", "queue_full");
    await expect(refusal).not.toBeEmpty();
    await expect(generate).toBeEnabled();
    expect(page.url()).toBe(choices);
    expect(count("generations")).toBe(rows);
  } finally {
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
  const progress = page.getByRole("progressbar", { name: "Progress" });
  let reported = 40;

  const notice = page.getByRole("status", { name: "Comfy connection" });

  // The real stream with Comfy at the dead port: the stored status, marked as the last known.
  await open(page, `/g/${id}`);
  await expect(notice).toBeVisible();
  await expect(status(page)).toHaveAttribute("data-status", "queued");
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
