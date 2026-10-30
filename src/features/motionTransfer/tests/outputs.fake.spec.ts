import { type APIRequestContext, expect, test } from "@playwright/test";

import { expectCurrentCategory, open } from "../../../../tests/e2e/session.ts";
import {
  generationPublicationSchema,
  generationReceiptSchema,
  generationSchema,
} from "../../../shared/contracts.ts";

// On the fake provider's server (project `fake`): a character image's result page `/g/:id` and,
// once its owner publishes it, its public share page `/r/:slug`, which show it by its outputs
// whatever workflow made it, say it is AI-generated (the FLUX Kommunity licence asks for it), its
// download is named so, and the main navigation marks Image current there, not Video.
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

  // Private until published: no share page.
  expect(generation.share_slug).toBeNull();

  const published = await request.post(`/api/generations/${receipt.id}/publish`);
  const { share_slug } = generationPublicationSchema.parse(await published.json());

  expect(published.status()).toBe(200);

  // Its share page, to anyone: the label and the alt text, and nothing of its caption.
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonymous.newPage();

  await open(visitor, `/r/${share_slug}`);
  await expect(visitor).toHaveTitle("AI-generated image · Open Photon");
  await expect(visitor.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "AI-generated image · Open Photon",
  );
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

/** A character image of `caption` through its route, once it is `status`; its generation. */
async function characterImage(request: APIRequestContext, caption: string, status: string) {
  const receipt = generationReceiptSchema.parse(
    await (await request.post("/api/character-generations", { data: { caption } })).json(),
  );

  const read = async () =>
    generationSchema.parse(await (await request.get(`/api/generations/${receipt.id}`)).json());

  await expect.poll(async () => (await read()).status, { timeout: 30_000 }).toBe(status);

  return read();
}

// A workflow that publishes on request (the FLUX Kommunity review before distribution) is
// published from its result page too, whatever feature made it.
test("a done image of a workflow that publishes on request is published from its result page", async ({
  page,
  request,
}) => {
  const generation = await characterImage(
    request,
    `A full-body portrait of a lighthouse keeper ${crypto.randomUUID()}, plain background.`,
    "done",
  );

  expect(generation.share_slug).toBeNull();

  await open(page, `/g/${generation.id}`);
  await expect(
    page.getByText(
      "Publishing makes this AI-generated image public at a share link; check it first.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish & copy link" }).click();

  const published = page.getByRole("status").filter({ hasText: /^Published/ });

  await expect(published).toBeVisible();

  const stored = generationSchema.parse(
    await (await request.get(`/api/generations/${generation.id}`)).json(),
  );

  expect(stored.share_slug).not.toBeNull();
  await expect(published).toHaveAttribute("data-share-slug", stored.share_slug ?? "");
  await expect(page.getByRole("link", { name: "Open share page" })).toHaveAttribute(
    "href",
    `/r/${stored.share_slug}`,
  );
});

test("a failed generation of any workflow is retried from its result page with a new seed, which opens the retry", async ({
  page,
  request,
}) => {
  const generation = await characterImage(
    request,
    `A portrait that fails ${crypto.randomUUID()}. [fake:provider_failed]`,
    "failed",
  );

  await open(page, `/g/${generation.id}`);
  await expect(page.getByRole("button", { name: "Publish & copy link" })).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).not.toHaveURL(new RegExp(`/g/${generation.id}$`));
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);

  const child = generationSchema.parse(
    await (await request.get(`/api/generations/${page.url().split("/").at(-1)}`)).json(),
  );

  expect(child.parent_id).toBe(generation.id);
  await expect(page.getByRole("status", { name: "Generation status" })).toBeVisible();
});
