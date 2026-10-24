import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { expect, test } from "@playwright/test";

import { addPrerenderedTakes, count, open } from "../../../../tests/e2e/session.ts";
import { generationSchema } from "../../../shared/contracts.ts";

// On the fake provider's server (project `fake`), signed in: from the gallery to a finished take
// of the example's motion and look, performed by the visitor's own photo. Browsing and opening
// the remake pay for nothing; Generate pays for one generation through the shared service.
const database = process.env.E2E_FAKE_DATABASE_PATH ?? "";

// The example's look, as the looks editor composes one (the visitor's words, kept character for
// character, then a background and a lighting pick), and a seed of its own: the remake must keep
// both byte for byte.
const words = "A dancer in a red  jacket,\nwhite sneakers.";

const look = `${words} Background: a sunny sandy beach with the blue sea and sky behind. Lighting: warm golden-hour sunlight from a low angle, long soft shadows.`;

const seed = 424_242;

// What `scripts/prerender-samples.mjs` renders every sample with: the workflow's own look and
// seed, as a blank look and seed send them.
const defaults: { prompt: string; seed: number } = JSON.parse(
  readFileSync("src/features/motionTransfer/workflows/defaults.json", "utf8"),
);

let prerendered: ReturnType<typeof addPrerenderedTakes>;

test.beforeAll(() => {
  prerendered = addPrerenderedTakes(database);

  // Arthur's take has a look and seed of its own; Maya's those of a real pre-rendered sample.
  const [example, , sample] = prerendered.takes;
  const writable = new DatabaseSync(database);

  try {
    const direct = writable.prepare(
      "UPDATE generations SET recipe = json_set(recipe, '$.params.prompt', ?, '$.params.seed', ?) WHERE id = ?",
    );

    direct.run(look, seed, example?.id ?? "");
    direct.run(defaults.prompt, defaults.seed, sample?.id ?? "");
  } finally {
    writable.close();
  }
});

test.afterAll(() => prerendered.remove());

/** Generations an access code paid for (each counts once against its code, `access_codes.used`). */
function usedTotal() {
  return count("generations WHERE access_code_id IS NOT NULL", database);
}

test("Explore → Make this with my character → upload a photo → Generate ends in a take with the example's motion, look and seed", async ({
  page,
  request,
}) => {
  const [example] = prerendered.takes;

  if (!example) {
    throw new Error("No sample characters were seeded");
  }

  const exampleRecipe = await (
    await request.get(`/api/generations/${example.id}/recipe.json`)
  ).json();

  const paid = usedTotal();
  const generations = count("generations", database);

  await open(page, "/explore");
  await page
    .getByRole("list", { name: "Examples" })
    .getByRole("link", { name: new RegExp(`^${example.title} performs`) })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${example.title} performs Street dance`,
  );
  await page.getByRole("link", { exact: true, name: "Make this with my character" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who performs it?");

  // The link loads the wizard afresh: wait for React before handing it a file.
  await page.locator("html[data-hydrated]").waitFor();

  // Nothing was stored or paid for on the way.
  expect(count("generations", database)).toBe(generations);
  expect(usedTotal()).toBe(paid);

  // The visitor's own photo, with likeness consent, performs it.
  await page.getByLabel("Upload a photo").setInputFiles("fixtures/wan/reference.png");
  await page.getByLabel("I may use this person's likeness").check();
  await page.getByRole("button", { name: "Use photo" }).click();
  await page.getByRole("button", { exact: true, name: "Continue" }).click();

  // The Direct step starts from the example: its look in the looks editor (the words and both
  // picks) and its seed, through a reload and Back and Forward.
  const direct = async () => {
    await expect(page.getByLabel("Prompt sent")).toHaveText(look);
    await expect(page.getByLabel("Look")).toHaveValue(words);

    for (const pick of ["Sunny beach", "Golden hour"]) {
      await expect(page.getByRole("button", { exact: true, name: pick })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }

    // The seed shows on the folded Advanced section's button.
    await expect(page.getByRole("button", { name: /^Advanced/ })).toContainText(`Seed: ${seed}`);
  };

  await direct();
  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await direct();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who performs it?");
  await page.goForward();
  await direct();
  expect(count("generations", database)).toBe(generations);

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your shot is ready", {
    timeout: 30_000,
  });

  const id = page.url().split("/g/")[1] ?? "";

  const generation = generationSchema.parse(
    await (await request.get(`/api/generations/${id}`)).json(),
  );

  const recipe = await (await request.get(`/api/generations/${id}/recipe.json`)).json();

  expect(generation.status).toBe("done");
  expect(id).not.toBe(example.id);
  expect(exampleRecipe.params.prompt).toBe(look);
  expect(recipe.params.prompt).toBe(look);
  expect(recipe.params.seed).toBe(seed);
  expect(recipe.inputs.driving_video_sha256).toBe(exampleRecipe.inputs.driving_video_sha256);
  expect(recipe.inputs.reference_image_sha256).not.toBe(
    exampleRecipe.inputs.reference_image_sha256,
  );
  // One new generation, paid for once, through the shared service.
  expect(count("generations", database)).toBe(generations + 1);
  expect(usedTotal()).toBe(paid + 1);
});

test("remaking a sample rendered with the workflow's defaults shows its look and seed in Direct, and Generate makes the recipe a blank look and seed make", async ({
  page,
}) => {
  const sample = prerendered.takes[2];

  if (!sample) {
    throw new Error("No sample characters were seeded");
  }

  const generations = count("generations", database);

  await open(page, `/explore/${sample.shareSlug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${sample.title} performs Street dance`,
  );
  await page.getByRole("link", { exact: true, name: "Make this with my character" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who performs it?");
  await page.locator("html[data-hydrated]").waitFor();
  await page.getByRole("button", { name: "Kenji" }).click();
  await page.getByRole("button", { exact: true, name: "Continue" }).click();

  // The look is the workflow's default, spelled out in the Look field as the take was made with
  // it (no picks) and sent as it is spelled.
  await expect(page.getByLabel("Look")).toHaveValue(defaults.prompt);
  await expect(page.getByLabel("Prompt sent")).toHaveText(defaults.prompt);
  await expect(page.getByRole("list", { name: "Your picks" })).toHaveCount(0);

  // The seed is the number, on the folded Advanced section's button and in its field.
  const advanced = page.getByRole("button", { name: /^Advanced/ });

  await expect(advanced).toContainText(`Seed: ${defaults.seed}`);
  await advanced.click();
  await expect(page.getByLabel("Seed", { exact: true })).toHaveValue(String(defaults.seed));
  expect(count("generations", database)).toBe(generations);

  const motion = new URL(page.url()).searchParams.get("motion");
  const kenji = prerendered.takes.find(({ title }) => title === "Kenji");

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your shot is ready", {
    timeout: 30_000,
  });

  const id = page.url().split("/g/")[1] ?? "";
  const recipe = await (await page.request.get(`/api/generations/${id}/recipe.json`)).json();

  expect(recipe.params.prompt).toBe(defaults.prompt);
  expect(recipe.params.seed).toBe(defaults.seed);

  // The same picks with a blank look and seed are the same recipe: the take is reused, not made
  // again.
  const blank = await page.request.post("/api/generate", {
    data: { character_id: kenji?.characterId, motion_asset_id: motion },
  });

  expect(await blank.json()).toMatchObject({ id, reused: true });
  expect(count("generations", database)).toBe(generations + 1);
});

test("on a remake of a sample rendered with the workflow's defaults, a picked background takes the place of the default's, as on a blank look", async ({
  page,
}) => {
  const sample = prerendered.takes[2];
  const kenji = prerendered.takes.find(({ title }) => title === "Kenji");

  if (!sample || !kenji) {
    throw new Error("No sample characters were seeded");
  }

  const beach = page.getByRole("button", { exact: true, name: "Sunny beach" });
  const sent = page.getByLabel("Prompt sent");

  await open(page, `/explore/${sample.shareSlug}`);
  await page.getByRole("link", { exact: true, name: "Make this with my character" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who performs it?");
  await page.locator("html[data-hydrated]").waitFor();

  const motion = new URL(page.url()).searchParams.get("motion") ?? "";

  await page.getByRole("button", { name: "Kenji" }).click();
  await page.getByRole("button", { exact: true, name: "Continue" }).click();
  await expect(page.getByLabel("Look")).toHaveValue(defaults.prompt);
  await beach.click();

  // One background: the beach, in place of the default's "as in the reference image".
  const remade = await sent.innerText();

  expect(remade.match(/\bBackground\b/g)).toHaveLength(1);
  expect(remade).toContain("Background: a sunny sandy beach");

  // The same pick on a blank look sends the same prompt, so it makes the same recipe.
  await open(page, `/motionTransfer?step=direct&motion=${motion}&character=${kenji.characterId}`);
  await expect(page.getByLabel("Look")).toHaveValue("");
  await beach.click();
  await expect(sent).toHaveText(remade);
});
