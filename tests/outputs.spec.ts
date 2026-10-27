import { expect, type Page, test } from "@playwright/test";

import {
  addOutputsGeneration,
  addPosterCopy,
  expectCurrentCategory,
  open,
  seededFiles,
  seededResult,
} from "./e2e/session.ts";

/** No cookies: a visitor without the access code, such as a social site's crawler. */
const anonymous = { cookies: [], origins: [] };

/** The `content` of the meta tag `property` (Open Graph) or `name`. */
function meta(page: Page, key: string) {
  return page.locator(`meta[property="${key}"], meta[name="${key}"]`);
}

// A generation of a workflow other than Motion Transfer is shown by the media of its outputs on
// its result page `/g/:id` and its share page `/r/:slug`: here one no feature registers, stored
// done and published with the seeded result's files.
test("video outputs play with their own posters, say they are AI-generated and download, on the result and share pages, whose card is the first video", async ({
  baseURL,
  browser,
  page,
}) => {
  const { poster, video } = seededFiles();
  const secondPoster = addPosterCopy();

  const generation = addOutputsGeneration({
    poster,
    "poster-2": secondPoster.id,
    video,
    "video-2": video,
  });

  const anonymousContext = await browser.newContext({ storageState: anonymous });

  try {
    const visitor = await anonymousContext.newPage();
    const origin = new URL(baseURL ?? "").origin;

    for (const [shown, path] of [
      [page, `/g/${generation.id}`],
      [visitor, `/r/${generation.shareSlug}`],
    ] as const) {
      await open(shown, path);
      await expect(shown).toHaveTitle("AI-generated video · Open Photon");
      await expectCurrentCategory(shown, "Video");
      await expect(shown.getByText("AI-generated video", { exact: true })).toHaveCount(2);
      await expect(shown.locator("video")).toHaveCount(2);

      // Each video with its own poster (`video-2` with `poster-2`), which never shows on its own.
      for (const [place, still] of [
        [1, poster],
        [2, secondPoster.id],
      ] as const) {
        const player = shown.getByLabel(
          `AI-generated video, made with Open Photon (video ${place} of 2)`,
          { exact: true },
        );

        await expect(player).toHaveAttribute("src", `/media/${video}.mp4`);
        await expect(player).toHaveAttribute("poster", `/media/${still}.jpg`);
        await expect(player).toHaveAttribute("controls", "");
        await expect(player).toHaveAttribute("playsinline", "");
        await expect(player).toHaveAttribute("preload", "metadata");
        await expect(shown.locator(`img[src="/media/${still}.jpg"]`)).toHaveCount(0);

        const download = shown.getByRole("link", { name: `Download video ${place} of 2` });

        await expect(download).toHaveAttribute("href", `/media/${video}.mp4?download=1`);
        await expect(download).toHaveAttribute("download", "");
      }
    }

    // The share card is the first video, with its poster as the card's image.
    await expect(meta(visitor, "og:title")).toHaveAttribute(
      "content",
      "AI-generated video · Open Photon",
    );
    await expect(meta(visitor, "og:type")).toHaveAttribute("content", "video.other");
    await expect(meta(visitor, "og:url")).toHaveAttribute(
      "content",
      `${origin}/r/${generation.shareSlug}`,
    );
    await expect(meta(visitor, "og:video")).toHaveAttribute(
      "content",
      `${origin}/media/${video}.mp4`,
    );
    await expect(meta(visitor, "og:video:type")).toHaveAttribute("content", "video/mp4");
    await expect(meta(visitor, "og:video:width")).toHaveAttribute("content", /^\d+$/);
    await expect(meta(visitor, "og:image")).toHaveAttribute(
      "content",
      `${origin}/media/${poster}.jpg`,
    );
    await expect(meta(visitor, "og:image:alt")).toHaveAttribute(
      "content",
      "AI-generated video, made with Open Photon",
    );
    await expect(meta(visitor, "twitter:card")).toHaveAttribute("content", "summary_large_image");

    // Anyone may download it, as a file.
    const download = await visitor.request.get(`/media/${video}.mp4?download=1`);

    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toBe(
      `attachment; filename="open-photon-${video.slice(0, 8)}.mp4"`,
    );
  } finally {
    await anonymousContext.close();
    generation.remove();
    secondPoster.remove();
  }
});

test("several image outputs show as a gallery, each labelled with its place, on the result and share pages", async ({
  browser,
  page,
}) => {
  const images = seededFiles().images.slice(0, 3);

  expect(images).toHaveLength(3);

  const generation = addOutputsGeneration(
    Object.fromEntries(
      images.map((id, index) => [index === 0 ? "image" : `image-${index + 1}`, id]),
    ),
  );

  const anonymousContext = await browser.newContext({ storageState: anonymous });

  try {
    const visitor = await anonymousContext.newPage();

    for (const [shown, path] of [
      [page, `/g/${generation.id}`],
      [visitor, `/r/${generation.shareSlug}`],
    ] as const) {
      await open(shown, path);
      await expect(shown).toHaveTitle("AI-generated image · Open Photon");
      await expectCurrentCategory(shown, "Image");
      await expect(shown.getByText("AI-generated image", { exact: true })).toHaveCount(3);
      await expect(shown.locator("video")).toHaveCount(0);

      for (const [index, id] of images.entries()) {
        const place = `image ${index + 1} of 3`;

        await expect(
          shown.getByRole("img", {
            exact: true,
            name: `AI-generated image, made with Open Photon (${place})`,
          }),
        ).toHaveAttribute("src", new RegExp(`^/media/${id}\\.[a-z]+$`));
        await expect(shown.getByRole("link", { name: `Download ${place}` })).toHaveAttribute(
          "href",
          new RegExp(`^/media/${id}\\.[a-z]+\\?download=1$`),
        );
      }
    }

    await expect(meta(visitor, "og:type")).toHaveAttribute("content", "website");
    await expect(meta(visitor, "og:video")).toHaveCount(0);
  } finally {
    await anonymousContext.close();
    generation.remove();
  }
});

test("a Motion Transfer take's result page keeps its title", async ({ page }) => {
  await open(page, `/g/${seededResult().id}`);
  await expect(page).toHaveTitle("Your take · Motion Transfer · Open Photon");
});
