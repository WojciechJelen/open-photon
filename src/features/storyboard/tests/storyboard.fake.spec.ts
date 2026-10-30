import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";
import { type Storyboard, storyboardSchema } from "../contracts.ts";

// On the fake provider's server (project `fake`): every card renders to the fake's PNG. A card's
// image is its own generation, so regenerating one leaves the others' images as they were.

/** Each card's current generation id, as the API reads the storyboard now. */
async function generationIds(page: Page, id: string) {
  const storyboard = storyboardSchema.parse(
    await (await page.request.get(`/api/storyboards/${id}`)).json(),
  );

  return storyboard.cards.map((card) => card.generation?.id ?? null);
}

async function rendered(page: Page, id: string) {
  await expect
    .poll(
      async () => {
        const storyboard: Storyboard = storyboardSchema.parse(
          await (await page.request.get(`/api/storyboards/${id}`)).json(),
        );

        return storyboard.cards.map((card) => card.generation?.status ?? null);
      },
      { timeout: 60_000 },
    )
    .toEqual(["done", "done", "done", "done"]);
}

test("make a storyboard of four hand-written scenes, edit one, generate all, regenerate one alone, reload and reopen it from the list", async ({
  page,
}) => {
  // A title and scenes no run used before, so every card is a new render.
  const run = randomUUID().slice(0, 8);

  const scenes = [
    `Wide shot of a rooftop at sunset, the character stretches (run ${run}).`,
    `Medium shot at dusk, the character dances as the lights come on (run ${run}).`,
    `Close-up at night, the character sits on the ledge with a water bottle (run ${run}).`,
    `High-angle wide shot at night, the character looks at the skyline (run ${run}).`,
  ];

  await open(page, "/storyboards");
  await expect(page.getByRole("heading", { level: 1, name: "Storyboards" })).toBeVisible();

  await page.getByRole("button", { name: "Maya" }).click();
  await page.getByLabel("What happens").fill("Maya on a rooftop from sunset to night.");
  await page.getByRole("textbox", { exact: true, name: "Title" }).fill(`Rooftop ${run}`);
  await page.getByRole("radio", { name: "Photo" }).click();
  await page.getByRole("radio", { name: "I'll write four" }).click();

  for (const [position, scene] of scenes.entries()) {
    await page.getByLabel(`Scene ${position + 1}`, { exact: true }).fill(scene);
  }

  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/storyboards") && response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Create storyboard" }).click();

  const storyboard = storyboardSchema.parse(await (await created).json());

  await expect(page).toHaveURL(`/storyboards/${storyboard.id}`);
  await expect(page.getByRole("heading", { level: 1, name: `Rooftop ${run}` })).toBeVisible();
  await expect(page.getByLabel("Scene 1 description")).toHaveValue(scenes[0] ?? "");

  // An edit stays on the page until Generate saves it.
  const edited = `Close-up at night, the character drinks from a water bottle (run ${run}).`;

  await page.getByLabel("Scene 3 description").fill(edited);
  await page.getByRole("button", { name: "Generate all" }).click();

  await rendered(page, storyboard.id);

  const cards = page.getByRole("list", { name: "Scene cards" }).getByRole("listitem");

  await expect(cards).toHaveCount(4);

  for (let number = 1; number <= 4; number += 1) {
    const card = page.getByRole("listitem", { name: `Scene ${number}: Rendered` });

    await expect(card.getByRole("img", { name: /AI-generated image/ })).toBeVisible();
    await expect(card.getByRole("link", { name: "Download" })).toBeVisible();
  }

  const first = await generationIds(page, storyboard.id);

  expect(new Set(first).size).toBe(4);

  // Regenerate scene 2 only: a new generation for it, the same ones for 1, 3 and 4.
  await page.getByRole("button", { name: "Regenerate scene 2" }).click();
  await expect
    .poll(async () => (await generationIds(page, storyboard.id))[1], { timeout: 30_000 })
    .not.toBe(first[1]);
  await rendered(page, storyboard.id);

  const second = await generationIds(page, storyboard.id);

  expect([second[0], second[2], second[3]]).toEqual([first[0], first[2], first[3]]);

  // A reload shows what was saved: the edit, every image.
  await page.reload();
  await expect(page.getByLabel("Scene 3 description")).toHaveValue(edited);
  await expect(page.getByRole("listitem", { name: /Scene \d: Rendered/ })).toHaveCount(4);

  // Reopened from the list.
  await open(page, "/storyboards");
  await page.getByRole("link", { name: new RegExp(`Rooftop ${run}`) }).click();
  await expect(page).toHaveURL(`/storyboards/${storyboard.id}`);
  await expect(page.getByLabel("Scene 3 description")).toHaveValue(edited);
  await expect(page.getByLabel("Scene 1 description")).toHaveValue(scenes[0] ?? "");
  expect(await generationIds(page, storyboard.id)).toEqual(second);
});

test("a scene whose render fails shows its error and is tried again alone", async ({ page }) => {
  const run = randomUUID().slice(0, 8);

  const scenes = [
    `Scene one of run ${run}.`,
    `Scene two of run ${run} [fake:provider_failed]`,
    `Scene three of run ${run}.`,
    `Scene four of run ${run}.`,
  ];

  const made = await page.request.post("/api/storyboards", {
    data: {
      character_id: storyboardSchema.shape.character.shape.id.parse(
        (await (await page.request.get("/api/characters")).json()).characters.find(
          (character: { title: string | null }) => character.title === "Theo",
        ).id,
      ),
      request_key: randomUUID(),
      scenes,
      sequence: `A failing card, run ${run}.`,
    },
  });

  const storyboard = storyboardSchema.parse(await made.json());

  await open(page, `/storyboards/${storyboard.id}`);
  await page.getByRole("button", { name: "Generate all" }).click();

  const failed = page.getByRole("listitem", { name: "Scene 2: Failed" });

  await expect(failed).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("listitem", { name: /Scene \d: Rendered/ })).toHaveCount(3);

  const before = await generationIds(page, storyboard.id);

  await failed.getByLabel("Scene 2 description").fill(`Scene two of run ${run}, fixed.`);
  await failed.getByRole("button", { name: "Try again scene 2" }).click();

  await expect(page.getByRole("listitem", { name: "Scene 2: Rendered" })).toBeVisible({
    timeout: 60_000,
  });

  const after = await generationIds(page, storyboard.id);

  expect([after[0], after[2], after[3]]).toEqual([before[0], before[2], before[3]]);
  expect(after[1]).not.toBe(before[1]);
});
