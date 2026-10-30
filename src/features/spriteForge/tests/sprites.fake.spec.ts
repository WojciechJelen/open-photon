import { expect, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";
import {
  createdSpriteSheetSchema,
  directionLabels,
  spriteDirections,
  spriteSetSchema,
} from "../contracts.ts";

// On the fake provider's server (project `fake`): every view renders the fake's PNG, and a sheet's
// atlases are that PNG too while its atlas descriptions are the fake's plain text, so the page
// offers the PNG downloads and says it could not read the description. The server's Comfy target
// is self-hosted (its `COMFY_BASE_URL`), so it can forge sheets.

test("pick a character, draw its five directions, forge a sprite sheet and find it again after a reload", async ({
  page,
}) => {
  await open(page, "/sprites");
  await expect(page.getByRole("heading", { level: 1, name: "Sprite Forge" })).toBeVisible();

  await page
    .getByRole("list", { name: "Characters" })
    .getByRole("button", { name: /Maya/ })
    .click();

  const admitted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/sprite-sets") && response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Draw 5 directions" }).click();

  const response = await admitted;
  const set = spriteSetSchema.parse(await response.json());

  expect(response.status()).toBe(201);
  expect(set.views.map((view) => view.direction)).toEqual([...spriteDirections]);
  await expect(page).toHaveURL(`/sprites/${set.id}`);

  // Each direction follows its own generation to done.
  for (const direction of spriteDirections) {
    await expect(
      page.getByRole("listitem", { exact: true, name: `${directionLabels[direction]}: Done` }),
    ).toBeVisible({ timeout: 60_000 });
  }

  // The side view faces right, and one take per direction keeps the fake run short.
  await page
    .getByRole("radiogroup", { name: "Side facing" })
    .getByRole("radio", { name: "Faces right" })
    .check();
  await page
    .getByRole("radiogroup", { name: "Takes per direction" })
    .getByRole("radio", { name: "Quick (1 take)" })
    .check();

  const forged = page.waitForResponse(
    (each) =>
      each.url().endsWith(`/api/sprite-sets/${set.id}/sheets`) &&
      each.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Forge sprite sheet" }).click();

  const sheetResponse = await forged;
  const { sheet } = createdSpriteSheetSchema.parse(await sheetResponse.json());

  expect(sheetResponse.status()).toBe(201);
  expect(sheet.takes).toBe(1);
  expect(sheet.facing).toEqual({ nw: "left", sw: "left", w: "right" });

  const sheets = page.getByRole("list", { name: "Sprite sheets" }).getByRole("listitem");

  await expect(sheets).toHaveCount(1);
  await expect(sheets.getByRole("link", { name: "Download HD PNG" })).toBeVisible({
    timeout: 120_000,
  });
  await expect(sheets.getByRole("link", { name: "Download pixel PNG" })).toBeVisible();
  await expect(sheets.getByText("This sheet's atlas description could not be read.")).toBeVisible();

  // The sheet belongs to the set, so a reload lists it, done.
  await page.reload();
  await expect(sheets).toHaveCount(1);
  await expect(sheets.getByRole("link", { name: "Download HD PNG" })).toBeVisible({
    timeout: 60_000,
  });
});
