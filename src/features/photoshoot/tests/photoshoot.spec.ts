import { expect, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";
import { photoshootSchema } from "../contracts.ts";

// On the server whose Comfy is a dead port (project `features`): nothing renders, so this covers
// what does not need a result: the consented upload as the reference, admission and the page.

test("a photo uploaded with consent becomes the photoshoot's character, and a shoot opens its page with four shots", async ({
  page,
}) => {
  await open(page, "/photoshoot");

  const upload = page.getByRole("button", { name: "Use photo" });

  await page.getByLabel("Reference photo").setInputFiles("fixtures/wan/reference.png");
  // The likeness consent comes first.
  await expect(upload).toBeDisabled();
  await page.getByLabel("I may use this person's likeness").check();
  await upload.click();

  // The upload joins the library and is picked.
  await expect(
    page.getByRole("list", { name: "Characters" }).getByRole("button", { pressed: true }),
  ).toHaveCount(1);
  await expect(page.getByText(/· Studio · 4 generations$/)).toBeVisible();

  const admitted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/photoshoots") && response.request().method() === "POST",
  );

  await page.getByRole("button", { name: "Shoot 4 photos" }).click();

  const photoshoot = photoshootSchema.parse(await (await admitted).json());

  expect(photoshoot.character?.origin).toBe("upload");
  await expect(page).toHaveURL(`/photoshoot/${photoshoot.id}`);
  await expect(page.getByTestId("photoshoot-shot")).toHaveCount(4);
  await expect(page.getByText("Three-quarter, hand on hip")).toBeVisible();
});

test("the photoshoot API refuses a request without a request key and an unknown photoshoot", async ({
  page,
}) => {
  await open(page, "/photoshoot");

  const missingKey = await page.request.post("/api/photoshoots", {
    data: { character_id: crypto.randomUUID(), setting: "studio" },
  });

  expect(missingKey.status()).toBe(400);
  expect((await page.request.get(`/api/photoshoots/${crypto.randomUUID()}`)).status()).toBe(404);
});
