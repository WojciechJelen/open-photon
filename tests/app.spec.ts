import { expect, test } from "@playwright/test";

import { accessCode, open, seededResult } from "./e2e/session.ts";

test("the studio home features Motion Transfer and links its live character tools, with nothing marked Soon", async ({
  page,
}) => {
  await open(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Make the shot.");

  const tools = page.locator("#tools");

  // The featured card is one link into the wizard.
  await tools.getByRole("link", { name: /Open Motion Transfer/ }).click();
  await expect(page).toHaveURL(/\/motionTransfer/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pick a motion");

  await open(page, "/");
  await expect(page.getByRole("list", { name: "Coming soon" })).toHaveCount(0);
  await expect(tools.getByText("Soon", { exact: true })).toHaveCount(0);

  const cards = page.getByRole("list", { name: "Character tools" }).getByRole("listitem");

  await expect(cards).toHaveCount(2);

  for (const [name, path] of [
    ["Describe a character", "/characters/new"],
    ["Character library", "/characters"],
  ] as const) {
    const card = cards.filter({ has: page.getByRole("heading", { name }) });

    await expect(card).toContainText("Live");
    await expect(card.getByRole("link")).toHaveAttribute("href", path);
  }

  await expect(page.getByText("Built open")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("MIT licensed");
});

test("no page scrolls sideways, on a phone or a desktop", async ({ page }) => {
  const { id, shareSlug } = seededResult();

  for (const width of [390, 1440]) {
    await page.setViewportSize({ height: 900, width });

    for (const path of ["/", "/motionTransfer", `/g/${id}`, `/r/${shareSlug}`]) {
      await open(page, path);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        `${path} at ${width} px`,
      ).toBeLessThanOrEqual(0);
    }
  }
});

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
