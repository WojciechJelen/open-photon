import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import { z } from "zod";

import { motionTransferModels } from "../src/features/genjutsu/workflows/registry.ts";
import { count, open, seededResult } from "./e2e/session.ts";

/** The SHA-256 of the workflow file, as `src/features/genjutsu/workflows/README.md` records it. */
const workflowSha256 = createHash("sha256")
  .update(readFileSync("src/features/genjutsu/workflows/motion-transfer.v1.json"))
  .digest("hex");

test("the recipe panel is collapsed until opened, on the result and on the share page", async ({
  page,
  request,
}) => {
  const { id, shareSlug } = seededResult();

  const recipe = await request.get(`/api/generations/${id}/recipe.json`);

  expect(recipe.status()).toBe(200);

  const recorded = z
    .object({
      models: z.array(z.object({ file: z.string(), license: z.string(), sha256: z.string() })),
    })
    .parse(await recipe.json());

  expect(recorded.models).toEqual(motionTransferModels);
  expect(
    z.object({ workflow: z.object({ sha256: z.string() }) }).parse(await recipe.json()).workflow
      .sha256,
  ).toBe(workflowSha256);

  for (const path of [`/g/${id}`, `/r/${shareSlug}`]) {
    await open(page, path);

    const details = page.getByRole("definition").filter({ hasText: workflowSha256 });

    const recipeToggle = page.getByRole("button", { name: /^Recipe motion-transfer v1 · seed/ });

    await expect(details).toBeHidden();
    await expect(recipeToggle).toHaveAttribute("aria-expanded", "false");
    await recipeToggle.click();
    await expect(details).toBeVisible();

    for (const model of motionTransferModels) {
      await expect(page.getByRole("definition").filter({ hasText: model.sha256 })).toBeVisible();
    }

    if (path.startsWith("/r/")) {
      await expect(
        page.getByRole("link", { name: "Open weights only · CI check" }),
      ).toHaveAttribute("href", /actions\/workflows\/ci.yml$/);
      await expect(page.getByRole("link", { name: "Model sources and hashes" })).toHaveAttribute(
        "href",
        /blob\/main\/models.lock$/,
      );
    }

    await recipeToggle.click();
    await expect(details).toBeHidden();
  }
});

test("re-running a done generation's recipe returns its own result: no new generation", async ({
  page,
}) => {
  const { id } = seededResult();
  const generations = count("generations");

  await open(page, `/g/${id}`);
  await page.getByRole("button", { name: /^Recipe/ }).click();
  await page.getByRole("button", { name: "Re-run recipe" }).click();
  await expect(page.getByRole("status", { name: "Re-run" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/g/${id}$`));
  expect(count("generations")).toBe(generations);
});
