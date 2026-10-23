import { expect, type Page, test } from "@playwright/test";

import { accessCode, open, seededResult } from "./e2e/session.ts";

const uuid = "[0-9a-f-]{36}";

/** The wizard's URL as an object: its step and picks. */
function searchOf(page: Page) {
  return Object.fromEntries(new URL(page.url()).searchParams);
}

/** The slate's Continue (or Generate) button, beside the step from `lg`. */
const slate = (page: Page) => page.getByRole("complementary", { name: "Your shot" });

test("a step needs its pick: Continue waits for one, and the stepper marks the current step", async ({
  page,
}) => {
  await open(page, "/motionTransfer");
  await expect(page).toHaveURL(/step=motion/);

  const stepper = page.getByRole("navigation", { name: "Steps" });

  await expect(stepper.locator('[aria-current="step"]')).toHaveText(/Motion/);
  // Character, Direct and Render are not reachable yet.
  await expect(stepper.getByRole("link", { name: "Character" })).toHaveCount(0);
  await expect(
    slate(page).getByRole("button", { name: "Pick a motion to continue" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Street dance" }).click();
  await expect(page.getByRole("button", { name: "Street dance" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await slate(page).getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`step=character&motion=${uuid}$`));
  await expect(stepper.locator('[aria-current="step"]')).toHaveText(/Character/);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(
    slate(page).getByRole("button", { name: "Pick a character to continue" }),
  ).toBeDisabled();

  // A link to a step whose picks are missing shows the furthest one it can reach.
  await open(page, `/motionTransfer?step=direct&motion=${seededResult().sourceAssetId}`);
  await expect(page).toHaveURL(/step=character/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who performs it?");
});

test("the whole tile toggles its pick, from the keyboard too", async ({ page }) => {
  await open(page, "/motionTransfer");

  const tile = page.getByRole("button", { name: "Street dance" });

  await tile.focus();
  await page.keyboard.press("Space");
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(new RegExp(`motion=${uuid}`));
  await page.keyboard.press("Enter");
  await expect(tile).toHaveAttribute("aria-pressed", "false");
  await expect(page).not.toHaveURL(/motion=/);
});

test("Back and Forward retrace the steps, a reload keeps the step, and the slate changes earlier picks", async ({
  page,
}) => {
  await open(page, "/motionTransfer");
  await page.getByRole("button", { name: "Street dance" }).click();
  await slate(page).getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Placeholder green" }).click();
  await slate(page).getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Direct the shot");

  const direct = page.url();

  expect(searchOf(page)).toMatchObject({ step: "direct" });
  await page.reload();
  await page.locator("html[data-hydrated]").waitFor();
  expect(page.url()).toBe(direct);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Direct the shot");
  await expect(slate(page)).toContainText("Street dance");
  await expect(slate(page)).toContainText("Placeholder green");

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who performs it?");
  await expect(page.getByRole("button", { name: "Placeholder green" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Direct the shot");

  // "Change" on the slate opens the step with its pick still made.
  await slate(page).getByRole("link", { name: "Change character" }).click();
  await expect(page).toHaveURL(/step=character/);
  await page.getByRole("button", { name: "Placeholder orange" }).click();
  await expect(page.getByRole("button", { name: "Placeholder green" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page
    .getByRole("navigation", { name: "Steps" })
    .getByRole("link", { name: "Direct" })
    .click();
  await expect(slate(page)).toContainText("Placeholder orange");
});

test("a link to the old picker opens the wizard with its picks", async ({ page }) => {
  const { characterId, sourceAssetId } = seededResult();

  await open(page, `/?motion=${sourceAssetId}&character=${characterId}`);
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/motionTransfer" &&
      url.searchParams.get("motion") === sourceAssetId &&
      url.searchParams.get("character") === characterId &&
      url.searchParams.get("step") === "direct",
  );
});

test.describe("without a session", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the header shows the access status; Generate asks for the code in a dialog, then goes on", async ({
    page,
  }) => {
    const { characterId, sourceAssetId } = seededResult();
    const sent: unknown[] = [];

    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/generate") {
        sent.push(request.postDataJSON());
      }
    });

    await open(
      page,
      `/motionTransfer?step=direct&motion=${sourceAssetId}&character=${characterId}`,
    );
    await page.getByRole("button", { name: "Neon street at night" }).click();
    await expect(page.getByLabel("Look")).toHaveValue(/neon-lit/);
    await slate(page).getByRole("button", { name: "Generate" }).click();

    const dialog = page.getByRole("dialog", { name: "Enter your access code" });

    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Access code")).toBeFocused();
    await dialog.getByLabel("Access code").fill("not-the-code");
    await dialog.getByRole("button", { name: "Unlock and generate" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByLabel("Access code").fill(accessCode());
    await dialog.getByRole("button", { name: "Unlock and generate" }).click();

    // The same choices went again, and the generation opened (Comfy is at a dead port).
    await expect(page).toHaveURL(new RegExp(`/g/${uuid}$`));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toMatchObject({ prompt: expect.stringContaining("neon-lit") });
  });

  test("the header's Access code opens the dialog, and the status turns active", async ({
    page,
  }) => {
    await open(page, "/motionTransfer");

    const header = page.getByRole("banner").filter({ visible: true });

    await header.getByRole("button", { name: "Access code" }).click();

    const dialog = page.getByRole("dialog", { name: "Enter your access code" });

    await dialog.getByLabel("Access code").fill(accessCode());
    await dialog.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(header.getByText("Code active")).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("a compact header counts the steps, and the bottom bar carries the pick and Continue", async ({
    page,
  }) => {
    await open(page, "/motionTransfer");
    await expect(page.getByRole("banner").getByText("Step 1 of 4")).toBeVisible();
    await expect(slate(page)).toBeHidden();

    await page.getByRole("button", { name: "Street dance" }).click();

    const continueButton = page.getByRole("button", { name: "Continue" });

    await expect(continueButton).toBeVisible();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await expect(page.getByRole("banner").getByText("Step 2 of 4")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBe(0);
  });
});
