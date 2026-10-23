import { expect, test } from "@playwright/test";

import { expectCurrentCategory, open } from "../../../../tests/e2e/session.ts";
import { generationReceiptSchema, generationSchema } from "../../../shared/contracts.ts";

// On the fake provider's server (project `fake`): a character image's result page `/g/:id` and
// public share page `/r/:slug`, which show it by its outputs whatever workflow made it, say it is
// AI-generated (the FLUX Kommunity licence asks for it), its download is named so, and the main
// navigation marks Image current there, not Video.
test("an image output says it is AI-generated on its result and share pages, and downloads as ai-generated-<id>", async ({
  browser,
  page,
  request,
}) => {
  const caption = `A full-body portrait of a beekeeper ${crypto.randomUUID()}, standing, plain background.`;

  const receipt = generationReceiptSchema.parse(
    await (await request.post("/api/character-generations", { data: { caption } })).json(),
  );

  let generation = generationSchema.parse(
    await (await request.get(`/api/generations/${receipt.id}`)).json(),
  );

  await expect
    .poll(
      async () => {
        generation = generationSchema.parse(
          await (await request.get(`/api/generations/${receipt.id}`)).json(),
        );

        return generation.status;
      },
      { timeout: 30_000 },
    )
    .toBe("done");

  const image = generation.outputs.find(({ name }) => name === "image");

  expect(image?.media).toBe("image");

  const src = image?.media === "image" ? `/media/${image.asset.id}.png` : "";

  // Its result page, with the access code.
  await open(page, `/g/${receipt.id}`);
  await expect(page.getByText("AI-generated image", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "AI-generated image, made with Open Photon" }),
  ).toHaveAttribute("src", src);
  await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute(
    "href",
    `${src}?download=1`,
  );
  await expectCurrentCategory(page, "Image");

  // Its share page, to anyone: the label and the alt text, and nothing of its caption.
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonymous.newPage();

  await open(visitor, `/r/${generation.share_slug}`);
  await expect(visitor.getByText("AI-generated image", { exact: true })).toBeVisible();
  await expect(
    visitor.getByRole("img", { name: "AI-generated image, made with Open Photon" }),
  ).toBeVisible();
  await expect(visitor.locator('meta[property="og:image:alt"]')).toHaveAttribute(
    "content",
    "AI-generated image, made with Open Photon",
  );
  await expect(visitor.getByText(caption)).toHaveCount(0);
  await expectCurrentCategory(visitor, "Image");

  const download = await visitor.request.get(`${src}?download=1`);

  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toBe(
    `attachment; filename="ai-generated-${image?.media === "image" ? image.asset.id.slice(0, 8) : ""}.png"`,
  );

  await anonymous.close();
});
