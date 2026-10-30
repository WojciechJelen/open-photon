import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";

import { open } from "../../../../tests/e2e/session.ts";
import { composeLook } from "../compose.ts";

const tile = (page: Page, name: string) => page.getByRole("button", { exact: true, name });

/** The prompt the Direct step will send, as the editor previews it. */
const sent = (page: Page) => page.getByLabel("Prompt sent");

/** Unfolds the Advanced row, which holds the lighting and the color; a new page folds it again. */
const openAdvanced = (page: Page) => page.getByRole("button", { name: /^Advanced/ }).click();

// On the fake provider's server (project `fake`): the look editor in the wizard's Direct step,
// end to end. Picks and the visitor's words compose one prompt, kept through a reload and the
// step links; the finished take's recipe holds that prompt byte for byte, and a draft started
// from the take reads the picks back; Reset goes back to the workflow's default.
test("looks compose with the description, survive a reload and step changes, land in the recipe as sent, and reset to the default", async ({
  page,
  request,
}) => {
  await open(page, "/motionTransfer");
  await page.getByRole("button", { name: "Street dance" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Arthur" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const description = page.getByLabel("Look");
  const words = "A dancer in a red  jacket,\nwhite sneakers.";

  await description.fill(words);
  await openAdvanced(page);
  await tile(page, "Sunny beach").click();
  await tile(page, "Golden hour").click();

  // Another background replaces the beach; the neon street, at night, drops the golden hour.
  await tile(page, "Neon street").click();
  await expect(page.getByRole("status")).toHaveText(
    "Neon street replaced Sunny beach. Golden hour removed: it does not combine with Neon street.",
  );
  await expect(tile(page, "Sunny beach")).toHaveAttribute("aria-pressed", "false");
  await expect(tile(page, "Golden hour")).toHaveAttribute("aria-pressed", "false");
  await tile(page, "Low-key").click();
  await tile(page, "Noir").click();

  const prompt = composeLook({
    description: words,
    selection: { background: "neon-street", lighting: "low-key", look: "noir" },
  });

  await expect(sent(page)).toHaveText(prompt);
  await expect(description).toHaveValue(words);

  // A reload keeps every pick and the words as typed.
  await expect(page).toHaveURL(/prompt=/);
  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await expect(sent(page)).toHaveText(prompt);
  await expect(page.getByLabel("Look")).toHaveValue(words);
  await openAdvanced(page);

  for (const name of ["Neon street", "Low-key", "Noir"]) {
    await expect(tile(page, name)).toHaveAttribute("aria-pressed", "true");
  }

  // So do the step links: back to Character and on to Direct again.
  await page
    .getByRole("navigation", { name: "Steps" })
    .getByRole("link", { name: "Character" })
    .click();
  await expect(page).toHaveURL(/step=character/);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(sent(page)).toHaveText(prompt);

  // A chip removes its pick; the words stay.
  await openAdvanced(page);
  await page.getByRole("button", { name: "Remove Noir" }).click();
  await expect(tile(page, "Noir")).toHaveAttribute("aria-pressed", "false");

  const final = composeLook({
    description: words,
    selection: { background: "neon-street", lighting: "low-key" },
  });

  await expect(sent(page)).toHaveText(final);

  const shot = new URL(page.url()).searchParams;

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);

  const id = page.url().split("/g/")[1] ?? "";

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your shot is ready", {
    timeout: 30_000,
  });

  // The recipe holds the composed prompt as sent, not look ids: a later catalog cannot change it.
  const recipe = z
    .object({ params: z.object({ prompt: z.string() }) })
    .parse(await (await request.get(`/api/generations/${id}/recipe.json`)).json());

  expect(recipe.params.prompt).toBe(final);

  // A shot started from the take reads its picks back out of the recipe's prompt.
  await open(
    page,
    `/motionTransfer?step=direct&from=${id}&motion=${shot.get("motion")}&character=${shot.get("character")}`,
  );
  await expect(sent(page)).toHaveText(final);
  await expect(page.getByLabel("Look")).toHaveValue(words);
  await expect(tile(page, "Neon street")).toHaveAttribute("aria-pressed", "true");
  await openAdvanced(page);
  await expect(tile(page, "Low-key")).toHaveAttribute("aria-pressed", "true");

  // Reset goes back to the workflow's default, a blank look, which a reload keeps too.
  await page.getByRole("button", { name: "Reset to default" }).click();
  await expect(page.getByLabel("Look")).toHaveValue("");
  await expect(sent(page)).toHaveText(/workflow's default/);
  await expect(page.getByRole("button", { name: "Reset to default" })).toBeDisabled();
  await expect(tile(page, "Neon street")).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  await expect(sent(page)).toHaveText(/workflow's default/);
  await openAdvanced(page);
  await expect(tile(page, "Low-key")).toHaveAttribute("aria-pressed", "false");
});
