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
    await expect(card.getByText("AI-generated", { exact: true })).toBeVisible();
    await expect(
      card.getByRole("link", { name: `Use this preset: ${preset.title}` }),
    ).toHaveAttribute("href", `/presets/${preset.id}?version=${preset.version}`);
  }

  await page.getByRole("link", { name: "Use this preset: Neon night" }).click();
  await expect(page).toHaveURL(/\/presets\/neon-night\?version=1$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Neon night");

  // The example take plays only when asked; its own controls join it from then on.
  const video = page.locator("video");

  await expect(video).not.toHaveAttribute("controls");
  await expect(video).not.toHaveAttribute("autoplay");
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.getByRole("button", { name: "Play example" }).click();
  await expect(page.getByRole("button", { name: "Pause example" })).toBeVisible();
  await expect(video).toHaveAttribute("controls", "");
  await page.getByRole("button", { name: "Pause example" }).click();
  await expect(page.getByRole("button", { name: "Play example" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Neon night");
  expect(count("generations")).toBe(generations);
  expect(posts).toEqual([]);
});

/** How many sentences of `prompt` set the background ("Background: …", "Background as in …"). */
const backgroundClauses = (prompt: string) =>
  prompt.match(/(?:^|\s)Background(?::| as in )/g)?.length ?? 0;

test("the preset fills in the look and seed byte for byte; the character and every edit survive a reload, and Motion Transfer opens on the same draft", async ({
  page,
}) => {
  const character = "The character from the reference image, as it appears there.";
  const presetLook = `${character} Background: a rooftop at golden hour.`;

  const neonStreet =
    "Background: a neon-lit city street at night, wet pavement reflecting pink and blue signs.";

  await open(page, "/presets/golden-hour-rooftop");
  // A link without a version records the one shown.
  await expect(page).toHaveURL(/version=1/);
  // The look is one row until Adjust shows its controls.
  await expect(page.getByText("A rooftop at golden hour", { exact: true })).toBeVisible();
  await expect(page.getByText("Background from this preset", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Adjust" }).click();

  const look = page.getByRole("textbox", { name: /Look/ });
  const seed = page.getByRole("textbox", { name: "Seed" });
  const sent = page.getByLabel("Prompt sent");

  // The preset's look is no catalog fragment, so the looks editor shows it as the visitor's own
  // words, and the prompt it sends is the preset's, unchanged.
  await expect(look).toHaveValue(presetLook);
  await expect(sent).toHaveText(presetLook);
  await expect(seed).toHaveValue("20261019");
  await expect(page.getByRole("button", { exact: true, name: "Neon street" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Generate without a character asks for one, and starts nothing.
  await page.getByRole("button", { exact: true, name: "Generate" }).click();
  await expect(page.getByRole("alert")).toHaveText("Pick a character first.");
  await expect(page.getByRole("alert")).toBeInViewport();

  await page.getByRole("button", { name: "Arthur" }).click();
  await expect(page).toHaveURL(/character=/);
  await expect(page.getByRole("alert")).toHaveCount(0);

  // An edit stays where it is: the search changes, the page does not scroll.
  await seed.scrollIntoViewIfNeeded();

  const scrolled = await page.evaluate(() => window.scrollY);

  await seed.fill("4242");
  await expect(page).toHaveURL(/seed=4242/);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  // A picked background takes the place of the preset's: the prompt asks for one.
  await page.getByRole("button", { exact: true, name: "Neon street" }).click();
  await expect(sent).toHaveText(`${character} ${neonStreet}`);
  await expect(look).toHaveValue("");
  await expect(page.getByText("Your look", { exact: true })).toBeVisible();

  // The reload opens on the changed look and seed, with Adjust's controls showing them.
  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await expect(page.getByRole("button", { name: "Arthur" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(seed).toHaveValue("4242");
  await expect(look).toHaveValue("");
  await expect(page.getByRole("button", { exact: true, name: "Neon street" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(sent).toHaveText(`${character} ${neonStreet}`);

  // Motion Transfer gets the preset as its draft: motion, character, look and seed, on Direct.
  await page.getByRole("link", { name: "Open in Motion Transfer" }).click();
  await expect(page).toHaveURL(/\/motionTransfer\?/);

  const search = new URL(page.url()).searchParams;

  expect(search.get("step")).toBe("direct");
  expect(search.get("seed")).toBe("4242");
  expect(search.get("motion")).toMatch(/^[0-9a-f-]{36}$/);
  expect(search.get("character")).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Prompt sent")).toHaveText(`${character} ${neonStreet}`);
});

test("a background picked on any preset replaces the preset's own: the prompt shown and the one Generate sends ask for one background", async ({
  page,
}) => {
  const sentBodies: { prompt?: string }[] = [];

  // Only the request matters here: answer it without rendering anything.
  await page.route("**/api/presets/*/generations", async (route) => {
    sentBodies.push(route.request().postDataJSON());
    await route.fulfill({
      json: { error: "Not rendered in this test.", reason: "preset_unavailable" },
      status: 409,
    });
  });

  for (const preset of presets) {
    await open(page, `/presets/${preset.id}?version=${preset.version}`);
    await page.getByRole("button", { name: "Adjust" }).click();

    const tiles = page.getByRole("group", { name: /^Background/ }).getByRole("button");
    const labels = (await tiles.allTextContents()).map((label) => label.trim());

    expect(labels.length).toBeGreaterThan(0);
    expect(backgroundClauses(preset.defaults.prompt)).toBe(1);

    for (const label of labels) {
      await open(page, `/presets/${preset.id}?version=${preset.version}`);
      await page.getByRole("button", { name: "Adjust" }).click();
      await page.getByRole("button", { name: "Arthur" }).click();
      await expect(page).toHaveURL(/character=/);

      const sent = page.getByLabel("Prompt sent");
      const tile = page.getByRole("button", { exact: true, name: label });

      await expect(sent).toHaveText(preset.defaults.prompt);
      await tile.click();
      await expect(tile).toHaveAttribute("aria-pressed", "true");
      await expect(sent).not.toHaveText(preset.defaults.prompt);

      const shown = (await sent.textContent()) ?? "";

      expect(backgroundClauses(shown), `${preset.id} + ${label}: ${shown}`).toBe(1);

      const before = sentBodies.length;

      await page.getByRole("button", { exact: true, name: "Generate" }).click();
      await expect.poll(() => sentBodies.length).toBe(before + 1);
      expect(sentBodies.at(-1)?.prompt, `${preset.id} + ${label}`).toBe(shown);
    }
  }
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
  await expect(page.getByText("This preset doesn't exist.")).toBeVisible();
});

test("the gallery and a preset's controls work from the keyboard", async ({ page }) => {
  await open(page, "/presets");

  const use = page.getByRole("link", { name: "Use this preset: Street dance" });

  await use.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/presets\/street-dance/);

  const reached: string[] = [];

  // The library lists every character the run's other specs saved too, so allow plenty of stops.
  for (let index = 0; index < 300 && !reached.includes("Generate"); index += 1) {
    await page.keyboard.press("Tab");

    // The text shown: Generate keeps the width of its other label in hidden text.
    const name = await page.evaluate(() => {
      const element = document.activeElement;
      const text = element instanceof HTMLElement ? element.innerText.trim() : "";

      return element?.getAttribute("aria-label") ?? text;
    });

    reached.push(name);

    if (name === "Adjust") {
      await page.keyboard.press("Enter");
    }
  }

  for (const name of [
    "Play example",
    "Add a photo",
    "Adjust",
    "Neon street",
    "Low-key",
    "Generate",
  ]) {
    expect(reached).toContain(name);
  }

  expect(reached.some((name) => name.includes("Arthur"))).toBe(true);
});

test("Back and Forward between two entries of one preset's page put each entry's look and seed in the form", async ({
  page,
}) => {
  const look = page.getByRole("textbox", { name: /Look/ });
  const seed = page.getByRole("textbox", { name: "Seed" });

  await open(page, "/presets/neon-night?version=1&seed=5");
  await expect(seed).toHaveValue("5");

  // A second history entry of the same page (as a restored tab or another link would make), then
  // Back and Forward to it: the router changes the search without mounting the page again.
  await page.evaluate(() => {
    window.history.pushState(
      window.history.state,
      "",
      "/presets/neon-night?version=1&seed=6&prompt=%22%22",
    );
    window.history.back();
  });
  await expect(page).toHaveURL(/seed=5/);
  await page.evaluate(() => window.history.forward());
  await expect(page).toHaveURL(/seed=6/);
  await expect(seed).toHaveValue("6");
  await expect(look).toHaveValue("");

  await page.goBack();
  await expect(page).toHaveURL(/seed=5/);
  await expect(seed).toHaveValue("5");
  await expect(look).toHaveValue(
    "The character from the reference image, as it appears there. Background: a neon-lit city street at night.",
  );
});

test("after a stale refusal, Reload the preset reloads it and sends no generation request", async ({
  page,
}) => {
  const posts: string[] = [];

  // The server's catalog moved on while the page was open: its first answer is a stale refusal.
  await page.route("**/api/presets/*/generations", async (route) => {
    posts.push(route.request().url());
    await route.fulfill({
      json: {
        error: "This preset changed since it was opened (version 1, now 2).",
        reason: "preset_stale",
      },
      status: 409,
    });
  });

  await open(page, "/presets/neon-night?version=1");
  await page.getByRole("button", { name: "Arthur" }).click();
  await expect(page).toHaveURL(/character=/);
  await page.getByRole("button", { exact: true, name: "Generate" }).click();

  const refusal = page.locator('[data-reason="preset_stale"]');

  await expect(refusal).toContainText("This preset changed since it was opened");
  expect(posts).toHaveLength(1);

  await refusal.getByRole("button", { name: "Reload the preset" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Neon night");
  // Long enough for a submit the click would have caused to have left.
  await page.waitForLoadState("networkidle");
  expect(posts).toHaveLength(1);
  await expect(page).toHaveURL(/\/presets\/neon-night/);
});
