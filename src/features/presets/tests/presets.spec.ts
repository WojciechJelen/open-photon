import { expect, test } from "@playwright/test";

import { count, expectCurrentCategory, open } from "../../../../tests/e2e/session.ts";
import { presets } from "../catalog.ts";

// On the server with Comfy at a dead port: browsing presets, the choices a reload keeps, the draft
// handed to Motion Transfer and a stale link. Nothing here generates: the fake spec does.

test("the gallery lists every preset with its example still, and opening it and a preset's page starts nothing", async ({
  page,
}) => {
  const generations = count("generations");
  const posts: string[] = [];

  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/")) {
      posts.push(request.url());
    }
  });

  // From the main navigation's Video menu.
  await open(page, "/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "Video" })
    .click();
  await page.getByRole("menuitem", { name: /Motion presets/ }).click();
  await expect(page).toHaveURL(/\/presets$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Start from a ready-made shot");
  await expectCurrentCategory(page, "Video");

  const cards = page.getByRole("list", { name: "Presets" }).getByRole("article");

  await expect(cards).toHaveCount(presets.length);

  for (const preset of presets) {
    const card = page.getByRole("article", { name: preset.title });

    await expect(card.getByRole("img")).toHaveAttribute(
      "alt",
      new RegExp(preset.example.character.title),
    );
    await expect(
      card.getByRole("link", { name: `Use this preset: ${preset.title}` }),
    ).toHaveAttribute("href", `/presets/${preset.id}?version=${preset.version}`);
  }

  await page.getByRole("link", { name: "Use this preset: Neon night" }).click();
  await expect(page).toHaveURL(/\/presets\/neon-night\?version=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Neon night");

  // The example take plays only when asked, with its own controls.
  const video = page.locator("video");

  await expect(video).toHaveAttribute("controls", "");
  await expect(video).not.toHaveAttribute("autoplay");
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.getByRole("button", { name: "Play example" }).click();
  await expect(page.getByRole("button", { name: "Pause example" })).toBeVisible();
  await page.getByRole("button", { name: "Pause example" }).click();
  await expect(page.getByRole("button", { name: "Play example" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Neon night");
  expect(count("generations")).toBe(generations);
  expect(posts).toEqual([]);
});

test("the preset fills in the look and seed; the character and every edit survive a reload, and Motion Transfer opens on the same draft", async ({
  page,
}) => {
  await open(page, "/presets/golden-hour-rooftop");
  // A link without a version records the one shown.
  await expect(page).toHaveURL(/version=1/);

  const look = page.getByRole("textbox", { name: /Look/ });
  const seed = page.getByRole("textbox", { name: "Seed" });

  await expect(look).toHaveValue(
    "The character from the reference image, as it appears there. Background: a rooftop at golden hour.",
  );
  await expect(seed).toHaveValue("20261019");
  await expect(page.getByRole("button", { name: "Golden-hour rooftop" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Generate without a character asks for one, and starts nothing.
  await page.getByRole("button", { exact: true, name: "Generate" }).click();
  await expect(page.getByRole("alert")).toHaveText("Pick a character first.");

  await page.getByRole("button", { name: "Arthur" }).click();
  await expect(page).toHaveURL(/character=/);
  await seed.fill("4242");
  await page.getByRole("button", { name: "Neon street at night" }).click();
  await expect(look).toHaveValue(/Background: a neon-lit city street at night\.$/);

  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await expect(page.getByRole("button", { name: "Arthur" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(seed).toHaveValue("4242");
  await expect(look).toHaveValue(
    "The character from the reference image, as it appears there. Background: a rooftop at golden hour. Background: a neon-lit city street at night.",
  );

  // Motion Transfer gets the preset as its draft: motion, character, look and seed, on Direct.
  await page.getByRole("link", { name: "Open in Motion Transfer" }).click();
  await expect(page).toHaveURL(/\/motionTransfer\?/);

  const search = new URL(page.url()).searchParams;

  expect(search.get("step")).toBe("direct");
  expect(search.get("seed")).toBe("4242");
  expect(search.get("motion")).toMatch(/^[0-9a-f-]{36}$/);
  expect(search.get("character")).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: /Look/ })).toHaveValue(
    "The character from the reference image, as it appears there. Background: a rooftop at golden hour. Background: a neon-lit city street at night.",
  );
});

test("a link to another version of a preset says so and waits; an unknown preset is not found", async ({
  page,
}) => {
  const generations = count("generations");

  await open(page, "/presets/street-dance?version=7");

  const stale = page.locator('[data-reason="preset_stale"]');

  await expect(stale).toContainText("made for version 7 of the preset");
  await expect(page.getByRole("button", { exact: true, name: "Generate" })).toBeDisabled();
  await stale.getByRole("button", { name: "Use version 1" }).click();
  await expect(page).toHaveURL(/version=1/);
  await expect(stale).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Generate" })).toBeEnabled();
  expect(count("generations")).toBe(generations);

  await open(page, "/presets/no-such-preset");
  await expect(page.getByText("Preset not found")).toBeVisible();
});

test("the gallery and a preset's controls work from the keyboard", async ({ page }) => {
  await open(page, "/presets");

  const use = page.getByRole("link", { name: "Use this preset: Street dance" });

  await use.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/presets\/street-dance/);

  const reached: string[] = [];

  for (let index = 0; index < 60 && !reached.includes("Generate"); index += 1) {
    await page.keyboard.press("Tab");
    reached.push(
      await page.evaluate(() => {
        const element = document.activeElement;

        return element?.getAttribute("aria-label") ?? element?.textContent?.trim() ?? "";
      }),
    );
  }

  for (const name of ["Play example", "Choose photo", "Neon street at night", "Generate"]) {
    expect(reached).toContain(name);
  }

  expect(reached.some((name) => name.includes("Arthur"))).toBe(true);
});
