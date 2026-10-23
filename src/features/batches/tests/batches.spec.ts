import { expect, type Page, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";
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
  await expect(page.getByText("Retry 1 (the shared retry renders with a new seed).")).toBeVisible();

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
