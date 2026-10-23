import { expect, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";
import { generationSchema } from "../../../shared/contracts.ts";

// On the fake provider's server (project `fake`): a take Comfy finishes, end to end in the
// browser, without a Comfy.
test("Generate follows a take to its result: the stream reports it done, the page plays it, the API lists its outputs", async ({
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

  const generation = generationSchema.parse(
    await (await request.get(`/api/generations/${id}`)).json(),
  );

  const video = generation.outputs.find(({ name }) => name === "video");

  expect(generation.status).toBe("done");
  expect(generation.outputs.map(({ media, name }) => [name, media])).toEqual([
    ["poster", "poster"],
    ["video", "video"],
  ]);
  await expect(page.locator('video[aria-label="Result"]')).toHaveAttribute(
    "src",
    `/media/${video?.media === "video" ? video.asset.id : ""}.mp4`,
  );
});
