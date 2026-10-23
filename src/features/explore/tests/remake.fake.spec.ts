import { expect, test } from "@playwright/test";

import { addPrerenderedTakes, count, open } from "../../../../tests/e2e/session.ts";
import { generationSchema } from "../../../shared/contracts.ts";

// On the fake provider's server (project `fake`), signed in: from the gallery to a finished take
// of the example's motion and look, performed by the visitor's own photo. Browsing and opening
// the remake pay for nothing; Generate pays for one generation through the shared service.
const database = process.env.E2E_FAKE_DATABASE_PATH ?? "";

let prerendered: ReturnType<typeof addPrerenderedTakes>;

test.beforeAll(() => {
  prerendered = addPrerenderedTakes(database);
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
  await expect(page.getByRole("complementary", { name: "Your shot" })).toContainText(
    "e2e seeded result",
  );
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
  expect(recipe.params.prompt).toBe(exampleRecipe.params.prompt);
  expect(recipe.params.seed).toBe(exampleRecipe.params.seed);
  expect(recipe.inputs.driving_video_sha256).toBe(exampleRecipe.inputs.driving_video_sha256);
  expect(recipe.inputs.reference_image_sha256).not.toBe(
    exampleRecipe.inputs.reference_image_sha256,
  );
  // One new generation, paid for once, through the shared service.
  expect(count("generations", database)).toBe(generations + 1);
  expect(usedTotal()).toBe(paid + 1);
});
