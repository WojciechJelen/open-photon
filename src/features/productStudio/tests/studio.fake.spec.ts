// Product Studio end to end against the fake provider (the `fake` Playwright project): upload a
// product photo → say what it is → pick presets → generate → each shot's AI-labelled image →
// download → its result page; a reload keeps the shoot; a shot Comfy fails offers a retry. The
// fake answers every image with `tests/fixtures/fake-output.png`; a graph carrying
// `[fake:provider_failed]` fails.
import { expect, type Page, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";

const photo = "fixtures/wan/reference.png";

/** Fills the studio form: the photo, what it is, and exactly `presets` ticked. */
async function fill(page: Page, product: string, presets: string[]) {
  await open(page, "/product-studio");
  await page.getByLabel("Product photo").setInputFiles(photo);
  await expect(page.getByRole("img", { name: "The uploaded product photo" })).toBeVisible();
  await page.getByLabel("What is it?").fill(product);

  for (const preset of ["Packshot", "Lifestyle", "Advertising"]) {
    const box = page.getByRole("checkbox", { name: new RegExp(`^${preset}`) });

    await (presets.includes(preset) ? box.check() : box.uncheck());
  }
}

test("upload a product, generate a packshot and an ad visual, download one and open its result page", async ({
  page,
}) => {
  await fill(page, "a green glass bottle of port wine", ["Packshot", "Advertising"]);
  await page.getByRole("button", { name: "Generate 2 shots" }).click();

  await expect(page).toHaveURL(/[?&]shoot=[0-9a-f-]{36}/);

  const shots = page.getByRole("list", { name: "Shots" });
  const packshot = shots.getByRole("listitem", { name: "Packshot shot" });
  const advertising = shots.getByRole("listitem", { name: "Advertising shot" });

  for (const shot of [packshot, advertising]) {
    await expect(shot.getByRole("img", { name: /AI-generated image/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(shot.getByText("AI-generated image", { exact: true })).toBeVisible();
  }

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    packshot.getByRole("link", { name: "Download" }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^ai-generated-.+\.png$/);

  // A reload follows the shoot in the URL; the recent shoots list it.
  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await expect(packshot.getByRole("img", { name: /AI-generated image/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /a green glass bottle of port wine/ }).first(),
  ).toBeVisible();

  await advertising.getByRole("link", { name: "Result page" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("img", { name: /AI-generated image/ }).first()).toBeVisible();
});

test("a shot Comfy fails says so and offers a retry with a new seed", async ({ page }) => {
  await fill(page, "[fake:provider_failed] a perfume bottle", ["Lifestyle"]);
  await page.getByRole("button", { name: "Generate 1 shot" }).click();

  const shot = page.getByRole("listitem", { name: "Lifestyle shot" });

  await expect(shot.getByText("This shot failed.")).toBeVisible({ timeout: 30_000 });
  await shot.getByRole("button", { name: "Try again with a new seed" }).click();
  // The marker stays in the prompt, so the retry fails too, as the shot's second attempt.
  await expect(shot.getByText("Attempt 2")).toBeVisible({ timeout: 30_000 });
});
