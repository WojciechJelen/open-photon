import { expect, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";
import { characterListSchema } from "../../characters/index.ts";
import { angleSetSchema } from "../contracts.ts";

// On the fake provider's server (project `fake`): every view renders the fake's PNG. The set draws
// a random seed, so every run's views are new generations.

test("pick a character, choose views, see the grid of results and save one to the library", async ({
  page,
}) => {
  await open(page, "/angles");
  await expect(page.getByRole("heading", { level: 1, name: "Shots & Angles" })).toBeVisible();

  await page
    .getByRole("list", { name: "Characters" })
    .getByRole("button", { name: /Maya/ })
    .click();
  await expect(page).toHaveURL(/character=/);

  // Every view starts chosen; leave the front out.
  await page.getByRole("group", { name: "Views" }).getByRole("button", { name: "Front" }).click();
  await expect(page.getByRole("button", { name: "Generate 3 views" })).toBeVisible();

  const admitted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/angle-sets") && response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Generate 3 views" }).click();

  const response = await admitted;
  const set = angleSetSchema.parse(await response.json());

  expect(response.status()).toBe(201);
  expect(set.items.map((item) => item.view)).toEqual(["three-quarter", "profile", "close-up"]);
  await expect(page).toHaveURL(`/angles/${set.id}`);

  const views = page.getByRole("list", { name: "Views" }).getByRole("listitem");

  await expect(views).toHaveCount(3);

  // Each view follows its own generation to done and shows its image.
  for (const label of ["Three-quarter", "Profile", "Close-up"]) {
    const card = page.getByRole("listitem", { name: `${label}: Done` });

    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.getByRole("img", { name: /AI-generated image/ })).toBeVisible();
    await expect(card.getByRole("link", { name: "Download" })).toBeVisible();
  }

  // Save the profile to the library: once, then it says so (also after a reload).
  const profile = page.getByRole("listitem", { name: "Profile: Done" });
  const saved = page.waitForResponse((each) => each.url().includes("/items/1/character"));

  await profile.getByRole("button", { name: "Save to library" }).click();
  expect((await saved).status()).toBe(201);
  await expect(profile.getByRole("link", { name: "Saved to library" })).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("listitem", { name: "Profile: Done" }).getByRole("link", {
      name: "Saved to library",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem", { name: "Close-up: Done" }).getByRole("button", {
      name: "Save to library",
    }),
  ).toBeVisible();

  // The saved character is in the library, made by this feature.
  const library = characterListSchema.parse(
    await (await page.request.get("/api/characters?q=Shots%20%26%20Angles")).json(),
  );

  expect(
    library.characters.some(({ generation_id }) => generation_id === set.items[1]?.generation.id),
  ).toBe(true);
});
