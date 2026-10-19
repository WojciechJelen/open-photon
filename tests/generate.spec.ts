import { expect, type Page, test } from "@playwright/test";

import { count, open } from "./e2e/session.ts";

/** Records every server-function POST: `generate` is the only one, and it submits to Comfy. */
function serverFunctionPosts(page: Page) {
  const posts: string[] = [];

  page.on("request", (sent) => {
    if (sent.method() === "POST" && new URL(sent.url()).pathname.startsWith("/_serverFn/")) {
      posts.push(sent.url());
    }
  });

  return posts;
}

test("an invalid form shows why and never calls generate", async ({ page }) => {
  const posts = serverFunctionPosts(page);
  const generations = count("generations");

  await open(page, "/");
  await page.getByRole("button", { name: "Generate" }).click();

  const problems = page.getByRole("alert", { name: "Problems with the form" });

  await expect(problems).toContainText("Pick a motion first.");
  await expect(problems).toContainText("Pick a character first.");

  await page.getByRole("button", { name: "Street dance" }).click();
  await page.getByRole("button", { name: "Placeholder blue" }).click();
  await expect(page).toHaveURL(/character=/);
  await page.getByRole("button", { name: "Advanced" }).click();
  await page.getByLabel("Seed").fill("-1");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(problems).toHaveText(/^The seed is a whole number/);
  await page.getByLabel("Seed").fill("7");
  await page.getByLabel("Appearance and background (optional)").fill("x".repeat(501));
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(problems).toHaveText("Keep the description under 500 characters.");

  // A submit that slipped through would have fired by now.
  await page.waitForTimeout(1500);
  expect(posts, "unexpected POST to the generate server function").toEqual([]);
  expect(count("generations")).toBe(generations);
});

test("with Comfy at a dead port, Generate opens a failed generation with the reason, and Retry opens its failed child", async ({
  page,
}) => {
  await open(page, "/");
  await page.getByRole("button", { name: "Street dance" }).click();
  await page.getByRole("button", { name: "Placeholder blue" }).click();
  await expect(page).toHaveURL(/character=/);
  await page.getByLabel("Profile").check();
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);

  const status = page.getByRole("status", { name: "Generation status" });

  await expect(status).toHaveText("failed");
  await expect(page.getByRole("alert")).toContainText("Could not connect to Comfy");
  await expect(page.getByText(/remaining|left|ETA/i)).toHaveCount(0);

  const parent = page.url();

  await page.getByRole("button", { name: "Retry with a new seed" }).click();
  await expect(page).not.toHaveURL(parent);
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
  await expect(status).toHaveText("failed");
  expect(count(`generations WHERE parent_id = '${parent.split("/g/")[1]}'`)).toBe(1);
});

test("an unknown generation is a not-found page", async ({ page }) => {
  await open(page, `/g/${crypto.randomUUID()}`);
  await expect(page.getByRole("heading", { name: "Generation not found" })).toBeVisible();
});
