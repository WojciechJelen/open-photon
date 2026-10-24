import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";

import { open, seededResult } from "../../../../tests/e2e/session.ts";
import { batchListSchema, batchSchema } from "../contracts.ts";

// On the server whose Comfy is a dead port (project `features`): nothing renders, so a batch's
// takes fail as Comfy cannot be reached, which shows what a failed take offers.

/** The wizard on Direct for the sample motion and Arthur, with `look`. */
async function direct(page: Page, look: string) {
  await open(page, "/motionTransfer");
  await page.getByRole("button", { name: "Street dance" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Arthur" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Look").fill(look);
}

/** Runs `use` on the e2e server's database, as an operator's script would. */
function database<T>(use: (connection: DatabaseSync) => T) {
  const connection = new DatabaseSync(process.env.E2E_DATABASE_PATH ?? "");

  try {
    connection.exec("PRAGMA busy_timeout = 5000");

    return use(connection);
  } finally {
    connection.close();
  }
}

/** A new access code for `max` generations on the e2e server (`scripts/mint-code.mjs`). */
function mintCode(max: number) {
  return execFileSync(process.execPath, ["scripts/mint-code.mjs", "e2e-batches", String(max)], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_PATH: process.env.E2E_DATABASE_PATH },
  }).trim();
}

test("Render is not held back by the allowance: the server admits a batch whose only new take fits, and says why it refuses one that does not", async ({
  browser,
}) => {
  // A code with one generation left, and the seeded done take (the sample motion, its
  // character, look "e2e seeded result", seed 1), which a batch gets back free.
  const code = mintCode(1);
  const seeded = seededResult();

  const shot = new URLSearchParams({
    character: seeded.characterId,
    motion: seeded.sourceAssetId,
    prompt: "e2e seeded result",
    seed: "1",
    step: "direct",
  });

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();

  await open(page, `/access?code=${code}&next=${encodeURIComponent(`/motionTransfer?${shot}`)}`);

  const variations = page
    .getByRole("complementary", { name: "Your shot" })
    .getByRole("button", { name: "Variations" });

  await variations.click();

  const dialog = page.getByRole("dialog", { name: "Render variations" });

  // Two new seeds need two generations: shown as information, and the server refuses it whole.
  await expect(dialog.getByText("your access code has 1 left", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Render 2 takes" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "This access code has 1 of its 1 generations left, and this request needs 2. Nothing was started.",
  );

  // The seeded take's character and one more: two takes, one of them already rendered.
  await dialog.getByRole("radio", { name: "Characters" }).click();
  await dialog
    .getByRole("button", { pressed: false })
    .filter({ has: page.getByRole("img") })
    .first()
    .click();
  await expect(dialog.getByText("your access code has 1 left", { exact: false })).toBeVisible();

  const admitted = page.waitForResponse(
    (response) => response.url().endsWith("/api/batches") && response.request().method() === "POST",
  );

  await dialog.getByRole("button", { name: "Render 2 takes" }).click();

  const response = await admitted;
  const batch = batchSchema.parse(await response.json());

  expect(response.status()).toBe(201);
  expect(batch.items.map((item) => item.reused)).toEqual([true, false]);
  expect(batch.items[0]?.generation.id).toBe(seeded.id);
  await expect(page).toHaveURL(`/batches/${batch.id}`);

  // The new take was charged at admission (the code's one generation), the reused one never. Comfy
  // is a dead port here, so the new take fails before the provider takes it, and that refunds it:
  // wait for the failure, then the code has its generation back and the reused take cost nothing.
  await expect
    .poll(
      async () =>
        batchSchema
          .parse(await (await page.request.get(`/api/batches/${batch.id}`)).json())
          .items.map((item) => item.generation.status),
      { timeout: 30_000 },
    )
    .toEqual(["done", "failed"]);

  const list = batchListSchema.parse(await (await page.request.get("/api/batches")).json());

  expect(list.allowance).toEqual({ max: 1, remaining: 1, used: 0 });
  await context.close();
});

test("a landscape take shows its whole frame in the comparison grid, on desktop and on a phone", async ({
  page,
}) => {
  const created = await page.request.post("/api/batches", {
    data: {
      request_key: randomUUID(),
      shot: { character: seededResult().characterId, motion: seededResult().sourceAssetId },
      // Seeds no run used before, so the takes are new (an earlier run's would come back reused).
      variation: { kind: "seeds", seeds: [randomInt(2 ** 40), 2 ** 40 + randomInt(2 ** 40)] },
    },
  });

  const batch = batchSchema.parse(await created.json());

  // A 320×240 clip stored as the second take's result, as finalize stores an 848×480 one.
  const upload = await page.request.post("/api/uploads", {
    multipart: {
      file: {
        buffer: readFileSync("tests/fixtures/long-12s.mp4"),
        mimeType: "video/mp4",
        name: "landscape.mp4",
      },
    },
  });

  const landscape = z
    .object({ height: z.int(), id: z.uuid(), width: z.int() })
    .parse(await upload.json());

  expect(landscape.width).toBeGreaterThan(landscape.height);

  const take = batch.items[1]?.generation.id ?? "";

  // Comfy is a dead port: the take fails first, then is stored done with the landscape result.
  await expect
    .poll(
      async () =>
        batchSchema.parse(await (await page.request.get(`/api/batches/${batch.id}`)).json())
          .items[1]?.generation.status,
      { timeout: 30_000 },
    )
    .toBe("failed");

  // As finalize leaves a finished job: its job id, `done`, the result as output `video`.
  database((connection) => {
    connection
      .prepare(
        `UPDATE generations SET status = 'done', progress = 100, provider_job_id = ?,
          final_asset_id = ?, finished_at = ? WHERE id = ?`,
      )
      .run(`e2e-landscape-${take}`, landscape.id, new Date().toISOString(), take);
    connection
      .prepare(
        "INSERT INTO generation_outputs (generation_id, name, asset_id) VALUES (?, 'video', ?)",
      )
      .run(take, landscape.id);
  });

  for (const viewport of [
    { height: 800, width: 1280 },
    { height: 844, width: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await open(page, `/batches/${batch.id}`);

    const video = page.locator('video[aria-label="Take 2"]');

    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.videoWidth))
      .toBe(320);

    // Letterboxed, not cropped: the whole 4:3 frame fits the portrait cell.
    const frame = await video.evaluate((element: HTMLVideoElement) => {
      const box = element.getBoundingClientRect();
      const fit = getComputedStyle(element).objectFit;

      const scale =
        fit === "cover"
          ? Math.max(box.width / element.videoWidth, box.height / element.videoHeight)
          : Math.min(box.width / element.videoWidth, box.height / element.videoHeight);

      return { fit, shown: element.videoWidth * scale, width: box.width };
    });

    expect(frame.fit).toBe("contain");
    expect(frame.shown).toBeLessThanOrEqual(frame.width + 0.5);
  }
});

test("Variations shows the takes, what stays the same and the allowance before anything starts, from the keyboard", async ({
  page,
}) => {
  const before = batchListSchema.parse(await (await page.request.get("/api/batches")).json());

  await direct(page, "Background: a keyboard rehearsal.");

  // Generate stays the plain action; Variations sits beside it.
  const panel = page.getByRole("complementary", { name: "Your shot" });

  await expect(panel.getByRole("button", { name: "Generate" })).toBeVisible();

  const variations = panel.getByRole("button", { name: "Variations" });

  await variations.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Render variations" });

  await expect(
    dialog.getByRole("heading", { name: "2 takes, same motion and look" }),
  ).toBeVisible();
  await expect(dialog.getByText("Background: a keyboard rehearsal.")).toBeVisible();
  await expect(dialog.getByText("Arthur")).toBeVisible();

  const takes = dialog.getByRole("list", { name: "Takes" }).getByRole("listitem");

  await expect(takes).toHaveCount(2);
  await expect(takes.first()).toHaveText(/Take 1\s*Seed \d+/);
  await expect(
    dialog.getByText(
      `Uses up to 2 of the ${before.allowance.remaining} generations your access code has left.`,
      { exact: false },
    ),
  ).toBeVisible();

  // Four takes, by keyboard: the count's radio, then New seeds draws four others.
  await dialog.getByRole("radio", { name: "4 takes" }).focus();
  await page.keyboard.press("Space");
  await expect(takes).toHaveCount(4);

  const seeds = await takes.allTextContents();

  await dialog.getByRole("button", { name: "New seeds" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => takes.allTextContents()).not.toEqual(seeds);
  await expect(dialog.getByRole("button", { name: "Render 4 takes" })).toBeEnabled();

  // One character is not a batch; two are.
  await dialog.getByRole("radio", { name: "Characters" }).click();
  await expect(dialog.getByRole("button", { name: "Render 1 take" })).toBeDisabled();
  await dialog.getByRole("button", { name: /^Maya/ }).click();
  await expect(dialog.getByRole("button", { name: "Render 2 takes" })).toBeEnabled();

  // Closing it starts nothing.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(variations).toBeFocused();

  const after = batchListSchema.parse(await (await page.request.get("/api/batches")).json());

  expect(after.batches.length).toBe(before.batches.length);
  expect(after.allowance).toEqual(before.allowance);
});

test("a take that fails keeps its place in the batch and offers the shared retry", async ({
  page,
}) => {
  await direct(page, "Background: a failing rehearsal.");
  await page
    .getByRole("complementary", { name: "Your shot" })
    .getByRole("button", { name: "Variations" })
    .click();

  const dialog = page.getByRole("dialog", { name: "Render variations" });

  const admitted = page.waitForResponse(
    (response) => response.url().endsWith("/api/batches") && response.request().method() === "POST",
  );

  await dialog.getByRole("button", { name: "Render 2 takes" }).click();

  const batch = batchSchema.parse(await (await admitted).json());

  await expect(page).toHaveURL(`/batches/${batch.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2 seed variations");

  // Comfy cannot be reached, so neither take renders; both stay in the batch, failed.
  await expect(page.getByRole("heading", { name: "2 of 2 finished" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('li[aria-label$="Failed"]')).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Use this take" })).toHaveCount(0);

  // Retry is the shared one: the take's generation gets a child with a new seed, which the batch
  // follows as the take's next attempt.
  await page.getByRole("button", { name: "Retry take 1" }).click();
  await expect(page.getByText("Attempt 2: rendered again after a failure.")).toBeVisible();

  const retried = batchSchema.parse(
    await (await page.request.get(`/api/batches/${batch.id}`)).json(),
  );

  expect(retried.items[0]?.attempt).toBe(1);
  expect(retried.items[0]?.generation.parent_id).toBe(batch.items[0]?.generation.id);
  expect(retried.items[1]?.attempt).toBe(0);

  // The list of batches names it.
  await open(page, "/batches");
  await expect(page.getByRole("link", { name: /2 seed variations/ }).first()).toBeVisible();
});
