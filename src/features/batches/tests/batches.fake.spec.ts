import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";
import { batchListSchema, batchSchema } from "../contracts.ts";

// On the fake provider's server (project `fake`, `IN_FLIGHT_MAX=4`): a batch of six characters is
// larger than the places in flight, so two of its takes wait in line while four render. It
// renders with no batch page open, and the page shows it again when it is opened.

/** The wizard on Direct for the sample motion and Arthur, with `look`. */
async function direct(page: Page, look: string) {
  await open(page, "/motionTransfer");
  await page.getByRole("button", { name: "Street dance" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Arthur" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Look").fill(look);
}

test("a six-character batch queues past the places in flight, renders with its page closed, and its takes compare, open and download", async ({
  page,
}) => {
  // The page's own requests: they carry its access session.
  const { request } = page;

  const allowance = batchListSchema.parse(
    await (await request.get("/api/batches")).json(),
  ).allowance;

  // A look no run used before, so every take is new (an earlier run's would come back reused).
  const look = `Background: a batch rehearsal stage, run ${randomUUID().slice(0, 8)}.`;

  await direct(page, look);
  await page.getByRole("button", { name: "Variations" }).click();

  const dialog = page.getByRole("dialog", { name: "Render variations" });

  await dialog.getByRole("radio", { name: "Characters" }).click();

  // Arthur, the shot's character, is picked already; five more make six.
  for (const name of ["Kenji", "Maya", "Rosa", "Theo", "Yuki"]) {
    await dialog.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  }

  await expect(
    dialog.getByRole("heading", { name: "6 takes, same motion and look" }),
  ).toBeVisible();
  await expect(dialog.getByText(look)).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Takes" }).getByRole("listitem")).toHaveCount(6);
  await expect(
    dialog.getByText(
      `Uses up to 6 of the ${allowance.remaining} generations your access code has left.`,
      {
        exact: false,
      },
    ),
  ).toBeVisible();

  const admitted = page.waitForResponse(
    (response) => response.url().endsWith("/api/batches") && response.request().method() === "POST",
  );

  await dialog.getByRole("button", { name: "Render 6 takes" }).click();

  const response = await admitted;
  const batch = batchSchema.parse(await response.json());

  expect(response.status()).toBe(201);
  await expect(page).toHaveURL(`/batches/${batch.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("6 characters, one shot");

  // Admitted at once, every take in line in order: the dispatcher starts at most four.
  expect(batch.items.map((item) => item.generation.status)).toEqual(Array(6).fill("waiting"));
  expect(batch.items.map((item) => item.character?.title)).toEqual([
    "Arthur",
    "Kenji",
    "Maya",
    "Rosa",
    "Theo",
    "Yuki",
  ]);

  // The same request again (a lost answer, a reload that resubmits) is the same batch.
  const repeated = await request.post("/api/batches", {
    data: JSON.parse(response.request().postData() ?? "{}"),
  });

  expect(repeated.status()).toBe(200);
  expect(batchSchema.parse(await repeated.json()).items.map((item) => item.generation.id)).toEqual(
    batch.items.map((item) => item.generation.id),
  );

  // The page is left while the batch renders; the server goes on with no batch page open.
  await open(page, "/batches");
  await expect(page.getByRole("link", { name: /6 characters, one shot/ }).first()).toBeVisible();

  let mostRunning = 0;

  await expect
    .poll(
      async () => {
        const current = batchSchema.parse(
          await (await request.get(`/api/batches/${batch.id}`)).json(),
        );

        const statuses = current.items.map((item) => item.generation.status);

        mostRunning = Math.max(
          mostRunning,
          statuses.filter((status) =>
            ["preparing", "queued", "running", "finalizing"].includes(status),
          ).length,
        );

        return statuses;
      },
      { intervals: [100], timeout: 90_000 },
    )
    .toEqual(Array(6).fill("done"));
  expect(mostRunning).toBeLessThanOrEqual(4);

  // Opened again, the page shows the finished batch as the server has it.
  await open(page, `/batches/${batch.id}`);
  await expect(page.getByRole("heading", { name: "6 of 6 finished" })).toBeVisible();

  const takes = page.getByRole("listitem").filter({ has: page.locator("video") });

  await expect(takes).toHaveCount(6);
  await expect(page.locator('li[aria-label^="Take"][aria-label$="Completed"]')).toHaveCount(6);

  const done = batchSchema.parse(await (await request.get(`/api/batches/${batch.id}`)).json());
  const take = done.items[0];
  const video = take?.generation.outputs.find((output) => output.name === "video");

  expect(video?.media).toBe("video");
  await expect(page.getByRole("link", { name: "Download take 1" })).toHaveAttribute(
    "href",
    `/media/${video?.media === "video" ? video.asset.id : ""}.mp4?download=1`,
  );
  await expect(page.getByRole("link", { name: "Recipe of take 1" })).toHaveAttribute(
    "href",
    `/api/generations/${take?.generation.id}/recipe.json`,
  );
  await expect(page.getByRole("link", { name: "Share page of take 1" })).toHaveAttribute(
    "href",
    `/r/${take?.generation.share_slug}`,
  );

  // Every take plays on its own, and Play all starts them together.
  await page.getByRole("button", { name: "Play all" }).click();
  await expect(page.getByRole("button", { name: "Pause all" })).toBeVisible();

  // On a phone the takes still compare two by two, each with its downloads.
  await page.setViewportSize({ height: 844, width: 390 });
  await expect(page.getByRole("link", { name: "Download take 6" })).toBeAttached();

  const [left, right] = await Promise.all([
    page.locator('video[aria-label="Take 1"]').boundingBox(),
    page.locator('video[aria-label="Take 2"]').boundingBox(),
  ]);

  expect(left && right && Math.abs(left.y - right.y) < 1 && right.x > left.x).toBe(true);

  // "Use this take" opens the take's own result page.
  await page.getByRole("link", { name: "Use this take" }).first().click();
  await expect(page).toHaveURL(`/g/${take?.generation.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your shot is ready");
});
