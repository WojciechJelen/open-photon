import { DatabaseSync } from "node:sqlite";

import { expect, test } from "@playwright/test";
import { z } from "zod";

import { open } from "../../../../tests/e2e/session.ts";
import { generationSchema } from "../../../shared/contracts.ts";
import { findPreset } from "../catalog.ts";

const recipeSchema = z.object({
  inputs: z.object({ driving_video_sha256: z.string() }),
  params: z.object({ prompt: z.string(), seed: z.int() }),
});

/** The preset provenance the fake server's database recorded for generation `id`. */
function provenance(id: string) {
  const database = new DatabaseSync(process.env.E2E_FAKE_DATABASE_PATH ?? "", { readOnly: true });

  try {
    return z
      .object({ overrides: z.string(), preset_id: z.string(), preset_version: z.int() })
      .parse(
        database
          .prepare(
            "SELECT preset_id, preset_version, overrides FROM preset_generations WHERE generation_id = ?",
          )
          .get(id),
      );
  } finally {
    database.close();
  }
}

// On the fake provider's server (project `fake`): from the gallery through a preset's page to a
// finished take, which renders the preset's motion, look and seed and records the preset version.
test("a visitor picks a preset, adds a sample character, and the take renders the preset's shot to the end", async ({
  page,
  request,
}) => {
  const preset = findPreset("neon-night");

  expect(preset).toBeDefined();

  await open(page, "/presets");
  await page.getByRole("link", { name: "Use this preset: Neon night" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Neon night");
  await page.getByRole("button", { name: "Kenji" }).click();
  await expect(page).toHaveURL(/character=/);
  await page.getByRole("button", { exact: true, name: "Generate" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your shot is ready", {
    timeout: 30_000,
  });

  const id = page.url().split("/g/")[1] ?? "";

  const generation = generationSchema.parse(
    await (await request.get(`/api/generations/${id}`)).json(),
  );

  expect(generation.status).toBe("done");
  expect(generation.outputs.map(({ name }) => name)).toContain("video");

  const recipe = recipeSchema.parse(
    await (await request.get(`/api/generations/${id}/recipe.json`)).json(),
  );

  expect(recipe.params).toEqual({ prompt: preset?.defaults.prompt, seed: preset?.defaults.seed });
  expect(recipe.inputs.driving_video_sha256).toBe(preset?.motion.sha256);
  expect(provenance(id)).toEqual({ overrides: "{}", preset_id: "neon-night", preset_version: 1 });
});

test("an edited look and seed render as edited and are recorded as the visitor's changes", async ({
  page,
  request,
}) => {
  await open(page, "/presets/golden-hour-rooftop");
  await page.getByRole("button", { name: "Theo" }).click();
  await expect(page).toHaveURL(/character=/);
  await page.getByRole("textbox", { name: /Look/ }).fill("Background: a rooftop at golden hour.");
  await page.getByRole("textbox", { name: "Seed" }).fill("99");
  await page.getByRole("button", { exact: true, name: "Generate" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your shot is ready", {
    timeout: 30_000,
  });

  const id = page.url().split("/g/")[1] ?? "";

  const recipe = recipeSchema.parse(
    await (await request.get(`/api/generations/${id}/recipe.json`)).json(),
  );

  expect(recipe.params).toEqual({ prompt: "Background: a rooftop at golden hour.", seed: 99 });
  expect(JSON.parse(provenance(id).overrides)).toEqual({
    prompt: "Background: a rooftop at golden hour.",
    seed: 99,
  });
});
