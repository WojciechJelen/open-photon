import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";

// On the server whose Comfy is a dead port (project `features`): nothing renders, so a scene split
// fails, and the page says so and keeps the cards editable.

test("a scene split that cannot reach Comfy is reported; the four cards stay editable and are saved", async ({
  page,
}) => {
  const run = randomUUID().slice(0, 8);

  await open(page, "/storyboards");
  await page.getByRole("button", { name: "Kenji" }).click();
  await page.getByRole("radio", { name: "Photo" }).click();
  await page.getByLabel("Sequence").fill(`Kenji walks his dog through a park at dawn, run ${run}.`);
  await page.getByRole("button", { name: "Create storyboard" }).click();

  await expect(page).toHaveURL(/\/storyboards\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("alert").filter({ hasText: "could not be written" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Split again" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: /Scene \d: Not rendered/ })).toHaveCount(4);

  // Written by hand instead, then saved: a reload shows it.
  await page.getByLabel("Scene 1 description").fill(`Wide shot of a park at dawn, run ${run}.`);
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeDisabled();

  await page.reload();
  await expect(page.getByLabel("Scene 1 description")).toHaveValue(
    `Wide shot of a park at dawn, run ${run}.`,
  );
  // A card without a description cannot be rendered.
  await expect(page.getByRole("button", { name: "Generate scene 2" })).toBeDisabled();
});

test("without the access code the storyboard API answers 401", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const response = await context.request.get("/api/storyboards");

  expect(response.status()).toBe(401);
  await context.close();
});
