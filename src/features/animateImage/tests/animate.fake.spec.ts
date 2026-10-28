// Animate Image end to end against the fake provider (the `fake` Playwright project): upload →
// describe → progress → playback → download; another feature's done image handed over with
// `animateImageHref` (`?generation=…&output=…`); a failed render and its retry. The fake answers
// every `SaveVideo` node with `tests/fixtures/fake-output.mp4` (and the server cuts its poster);
// a graph carrying `[fake:provider_failed]` fails.
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";

import { open } from "../../../../tests/e2e/session.ts";
import { generationReceiptSchema, generationSchema } from "../../../shared/contracts.ts";
import { animateImageHref, VIDEO_OUTPUT } from "../index.ts";

const video = (page: Page) => page.getByRole("region", { name: "Your animation" });
const statusOf = (page: Page) => video(page).locator("[data-status]");

/** The animation the page follows (`?take=`). */
function takeOf(page: Page) {
  return new URL(page.url()).searchParams.get("take");
}

test("upload an image, describe the action, follow the render, play and download the video", async ({
  page,
}) => {
  await open(page, "/animate");
  await expect(page.getByRole("heading", { name: "Animate an image", level: 1 })).toBeVisible();

  // Not the fake's own PNG: assets are stored once by content, so uploading the image the fake
  // answers every image node with would make the run's later image outputs that `upload` asset.
  await page
    .getByLabel("Image to animate")
    .setInputFiles("src/features/characters/samples/characters/kenji.png");
  await expect(page.getByRole("img", { name: "Image to animate: kenji.png" })).toBeVisible();
  // The 768×1344 still renders at 9:16.
  await expect(page.getByText("480×848, 5.1 s at 16 fps, MP4.")).toBeVisible();

  const animate = page.getByRole("button", { name: "Animate", exact: true });

  await expect(animate).toBeDisabled();
  await page.getByLabel("What happens in the video").fill(`The cube spins ${crypto.randomUUID()}.`);
  await animate.click();

  await expect.poll(() => takeOf(page)).not.toBeNull();
  // Progress while it renders, then the video with its poster.
  await expect(statusOf(page)).toBeVisible();

  const player = video(page).locator("video");

  await expect(statusOf(page)).toHaveText("Done", { timeout: 30_000 });
  await expect(player).toHaveAttribute("poster", /\/media\/.+\.jpg$/);

  // It plays: the browser reads the MP4's metadata.
  await expect
    .poll(() => player.evaluate((element: HTMLVideoElement) => element.readyState), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(1);

  const download = video(page).getByRole("link", { name: "Download video" });
  const href = await download.getAttribute("href");

  expect(href).toMatch(/\/media\/.+\.mp4\?download=1$/);

  const file = await page.request.get(href ?? "");

  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toBe("video/mp4");
  expect(file.headers()["content-disposition"]).toContain("attachment");

  // Its result page shows the same video.
  await video(page).getByRole("link", { name: "Result page" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
  await expect(page.locator("video")).toHaveAttribute("src", /\/media\/.+\.mp4$/);
});

test("a done image another feature hands over with animateImageHref is preselected and animates", async ({
  page,
}) => {
  // A done image generation, as the character builder makes one.
  const started = await page.request.post("/api/character-generations", {
    data: { caption: `A lighthouse keeper ${crypto.randomUUID()}`, seed: 1 },
  });

  expect(started.status()).toBe(201);

  const { id } = generationReceiptSchema.parse(await started.json());

  await expect
    .poll(
      async () =>
        generationSchema.parse(await (await page.request.get(`/api/generations/${id}`)).json())
          .status,
      { timeout: 30_000 },
    )
    .toBe("done");

  const href = animateImageHref({ generationId: id, output: "image" });

  expect(href).toBe(`/animate?generation=${id}&output=image`);

  await open(page, href);
  await expect(page.getByRole("img", { name: "Image to animate: Your result" })).toBeVisible();
  await page.getByRole("button", { name: /^Waves at the camera/ }).click();
  await page.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(statusOf(page)).toHaveText("Done", { timeout: 30_000 });
  await expect(video(page).locator("video")).toBeVisible();

  // The animation's recipe names the generation it started from.
  const take = takeOf(page);

  const recipe = z
    .object({ source: z.unknown() })
    .parse(await (await page.request.get(`/api/generations/${take}/recipe.json`)).json());

  expect(recipe.source).toEqual({ generation_id: id, kind: "generation", output: "image" });

  // A video is no image to animate.
  await open(page, animateImageHref({ generationId: take ?? "", output: VIDEO_OUTPUT }));
  await expect(page.getByRole("alert")).toContainText(`has no image "${VIDEO_OUTPUT}"`);
});

test("a failed render says so and offers Retry, which opens the attempt it starts", async ({
  page,
}) => {
  await open(page, "/animate");
  await page.getByRole("button", { name: /^Animate Maya$/ }).click();
  await expect(page.getByRole("img", { name: "Image to animate: Maya" })).toBeVisible();
  await page
    .getByLabel("What happens in the video")
    .fill(`[fake:provider_failed] She jumps ${crypto.randomUUID()}.`);
  await page.getByRole("button", { name: "Animate", exact: true }).click();
  await expect(statusOf(page)).toHaveText("Failed", { timeout: 30_000 });

  const first = takeOf(page);

  await video(page).getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => takeOf(page)).not.toBe(first);
  // The marker is in the prompt, so the attempt fails the same way.
  await expect(statusOf(page)).toHaveText("Failed", { timeout: 30_000 });
});
