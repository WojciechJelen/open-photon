import { expect, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";
import { characterListSchema } from "../../characters/index.ts";
import { photoshootSchema } from "../contracts.ts";

// On the fake provider's server (project `fake`): the four shots render and finish, so the whole
// flow runs: pick a character, pick a setting, shoot, see four results, download one, save one.

test("a photoshoot of a library character renders four results that download and save to the library", async ({
  page,
}) => {
  await open(page, "/photoshoot");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Character photoshoot");

  const shoot = page.getByRole("button", { name: "Shoot 4 photos" });

  await expect(shoot).toBeDisabled();
  await page
    .getByRole("list", { name: "Characters" })
    .getByRole("button", { name: "Maya" })
    .click();
  await page.getByRole("radio", { name: /^Street/ }).click();
  await expect(page.getByText("Maya · Street · 4 generations")).toBeVisible();

  const admitted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/photoshoots") && response.request().method() === "POST",
  );

  await shoot.click();

  const response = await admitted;
  const photoshoot = photoshootSchema.parse(await response.json());

  expect(response.status()).toBe(201);
  expect(photoshoot.setting).toBe("street");
  await expect(page).toHaveURL(`/photoshoot/${photoshoot.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Maya · Street");

  const shots = page.getByTestId("photoshoot-shot");

  await expect(shots).toHaveCount(4);
  await expect(
    shots.getByRole("img", { name: "AI-generated image, made with Open Photon" }),
  ).toHaveCount(4, { timeout: 60_000 });

  // Each shot is named by its pose in the setting.
  for (const label of ["Leaning on a wall", "Crossing the street", "Café table", "Neon night"]) {
    await expect(shots.getByText(label)).toBeVisible();
  }

  const second = shots.nth(1);
  const download = page.waitForEvent("download");

  await second.getByRole("link", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toMatch(/^ai-generated-.+\.png$/);

  await second.getByRole("button", { name: "Save to library" }).click();
  await expect(second.getByRole("link", { name: "Saved to library" })).toBeVisible();

  const done = photoshootSchema.parse(
    await (await page.request.get(`/api/photoshoots/${photoshoot.id}`)).json(),
  );

  const generationId = done.items[1]?.generation.id;

  const library = characterListSchema.parse(
    await (await page.request.get("/api/characters?samples=0")).json(),
  );

  expect(library.characters.find((each) => each.generation_id === generationId)?.origin).toBe(
    "generated",
  );

  // A reload reads the photoshoot again from the server: the four results are still there.
  await page.reload();
  await expect(
    shots.getByRole("img", { name: "AI-generated image, made with Open Photon" }),
  ).toHaveCount(4);

  // The studio lists it among the earlier photoshoots.
  await open(page, "/photoshoot");
  await expect(page.getByRole("link", { name: /Maya · Street/ }).first()).toBeVisible();
});
