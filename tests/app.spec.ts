import { expect, test } from "@playwright/test";

import { seededResult } from "./e2e/session.ts";

const code = process.env.APP_ACCESS_CODE;

test.describe("without a session", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the access gate admits the right code and nothing else, then opens the page asked for", async ({
    page,
  }) => {
    test.skip(!code, "Set APP_ACCESS_CODE: without it the dev server has no gate.");

    const asked = `/g/${seededResult().id}`;

    await page.goto(asked);
    await expect(page).toHaveURL(/\/access\?next=/);
    await page.getByLabel("Access code").fill("not-the-code");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/access\?next=/);
    expect(await page.context().cookies()).toEqual([]);
    await page.getByLabel("Access code").fill(code ?? "");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(asked);
    await expect(page.getByRole("status", { name: "Generation status" })).toBeVisible();
  });
});

test("generation reads reject invalid and missing ids", async ({ request }) => {
  const missing = crypto.randomUUID();

  expect((await request.get("/api/generations/not-a-uuid")).status()).toBe(400);
  expect((await request.get("/api/generations/not-a-uuid/events")).status()).toBe(400);
  expect((await request.get(`/api/generations/${missing}`)).status()).toBe(404);
  expect((await request.get(`/api/generations/${missing}/events`)).status()).toBe(404);
});
