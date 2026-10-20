import { expect, test } from "@playwright/test";

import { accessCode, seededResult } from "./e2e/session.ts";

test.describe("without a session", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a generation's page asks for the code, admits the right one only, then opens", async ({
    page,
  }) => {
    const asked = `/g/${seededResult().id}`;

    await page.goto(asked);
    await expect(page).toHaveURL(/\/access\?next=/);
    await page.getByLabel("Access code").fill("not-the-code");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/access\?next=/);
    expect(await page.context().cookies()).toEqual([]);
    await page.getByLabel("Access code").fill(accessCode());
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
