import { expect, test } from "@playwright/test";

import { expectCurrentCategory, open } from "../../../../tests/e2e/session.ts";
import { generationSchema } from "../../../shared/contracts.ts";

// On the fake provider's server (project `fake`): a take Comfy finishes, end to end in the
// browser, without a Comfy; its result page `/g/:id` belongs to Video in the main navigation, and
// it and the public share page offer the stitched side-by-side as a second download.
test("Generate follows a take to its result: the stream reports it done, the page plays it, the API lists its outputs, the side-by-side downloads to anyone", async ({
  browser,
  page,
  request,
}) => {
  await open(page, "/motionTransfer");
  await page.getByRole("button", { name: "Street dance" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Placeholder blue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Profile").check();
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);

  const id = page.url().split("/g/")[1] ?? "";

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your shot is ready", {
    timeout: 30_000,
  });
  await expectCurrentCategory(page, "Video");

  // Opened afresh, the take's result page still marks Video current, not Image.
  await open(page, `/g/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your shot is ready");
  await expectCurrentCategory(page, "Video");

  const generation = generationSchema.parse(
    await (await request.get(`/api/generations/${id}`)).json(),
  );

  const video = generation.outputs.find(({ name }) => name === "video");
  const compare = generation.outputs.find(({ name }) => name === "compare");
  const compareId = compare?.media === "video" ? compare.asset.id : "";
  const compareSrc = `/media/${compareId}.mp4`;

  expect(generation.status).toBe("done");
  expect(generation.outputs.map(({ media, name }) => [name, media])).toEqual([
    ["compare", "video"],
    ["poster", "poster"],
    ["video", "video"],
  ]);
  await expect(page.locator('video[aria-label="Result"]')).toHaveAttribute(
    "src",
    `/media/${video?.media === "video" ? video.asset.id : ""}.mp4`,
  );
  await expect(page.getByRole("link", { name: "Download side-by-side (9:16)" })).toHaveAttribute(
    "href",
    `${compareSrc}?download=1`,
  );

  // The share page offers it to anyone, who may download it under its own name.
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonymous.newPage();

  await open(visitor, `/r/${generation.share_slug}`);
  await expect(visitor.getByRole("link", { name: "Download side-by-side (9:16)" })).toHaveAttribute(
    "href",
    `${compareSrc}?download=1`,
  );

  const download = await visitor.request.get(`${compareSrc}?download=1`);

  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toBe(
    `attachment; filename="open-photon-${compareId.slice(0, 8)}-compare.mp4"`,
  );

  await anonymous.close();
});
