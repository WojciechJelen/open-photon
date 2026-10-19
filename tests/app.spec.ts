import { expect, test } from "@playwright/test";

const code = process.env.APP_ACCESS_CODE;

test("the access gate admits the right code and nothing else", async ({ page }) => {
  test.skip(!code, "Set APP_ACCESS_CODE: without it the dev server has no gate.");

  await page.goto("/");
  await expect(page).toHaveURL(/\/access$/);
  await page.getByLabel("Access code").fill("not-the-code");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("status")).toHaveText("Incorrect access code. Please try again.");
  await page.getByLabel("Access code").fill(code ?? "");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Open Photon" })).toBeVisible();
});

test("generation reads reject invalid and missing ids", async ({ request }) => {
  if (code) {
    await request.post("/access", { form: { code }, maxRedirects: 0 });
  }

  const missing = crypto.randomUUID();

  expect((await request.get("/api/generations/not-a-uuid")).status()).toBe(400);
  expect((await request.get(`/api/generations/${missing}`)).status()).toBe(404);
});
