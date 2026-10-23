import { expect, type Page, test } from "@playwright/test";

import { open, seededResult } from "../../../../tests/e2e/session.ts";
import { lookCatalog } from "../catalog.ts";

const tile = (page: Page, name: string) => page.getByRole("button", { exact: true, name });

/** The wizard's Direct step on the seeded take's motion and character. */
async function openDirect(page: Page) {
  const { characterId, sourceAssetId } = seededResult();

  await open(page, `/motionTransfer?step=direct&motion=${sourceAssetId}&character=${characterId}`);
}

test("the look editor is reachable by keyboard: Tab walks the tiles, Space and Enter toggle them, the chips and Reset follow", async ({
  page,
}) => {
  await openDirect(page);

  const [first, second] = lookCatalog.options.filter(({ group }) => group === "background");

  await page.getByLabel("Look").focus();
  await page.keyboard.press("Tab");
  await expect(tile(page, first?.label ?? "")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(tile(page, first?.label ?? "")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  await expect(tile(page, second?.label ?? "")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tile(page, second?.label ?? "")).toHaveAttribute("aria-pressed", "true");
  await expect(tile(page, first?.label ?? "")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Prompt sent")).toContainText(second?.fragment ?? "");

  // Each tile says what it does.
  await expect(tile(page, second?.label ?? "")).toHaveAccessibleDescription(
    new RegExp(second?.description ?? ""),
  );

  const remove = page.getByRole("button", { name: `Remove ${second?.label}` });

  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Prompt sent")).toHaveText(/workflow's default/);

  // The limits are said where the looks are picked: no camera control.
  await expect(page.getByText("no option changes the camera angle")).toBeVisible();
});

test("a look's own sentence pasted into the description becomes its pick: selecting it never doubles it, removing it leaves none behind", async ({
  page,
}) => {
  await openDirect(page);

  const beach = lookCatalog.options.find(({ id }) => id === "beach");
  const fragment = beach?.fragment ?? "";
  const sent = page.getByLabel("Prompt sent");
  const copies = async () => ((await sent.textContent()) ?? "").split(fragment).length - 1;

  await page.getByLabel("Look").focus();
  await page.keyboard.insertText(`A dancer. ${fragment}`);

  // The sentence moved from the words to the tile.
  await expect(page.getByLabel("Look")).toHaveValue("A dancer.");
  await expect(tile(page, "Sunny beach")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status")).toHaveText("Sunny beach picked from your words.");
  await expect(sent).toHaveText(`A dancer. ${fragment}`);

  // Removing it removes the sentence; selecting it again adds it once.
  await tile(page, "Sunny beach").click();
  await expect(sent).toHaveText("A dancer.");
  await tile(page, "Sunny beach").click();
  await expect(sent).toHaveText(`A dancer. ${fragment}`);
  expect(await copies()).toBe(1);
  await page.getByRole("button", { name: "Remove Sunny beach" }).click();
  await expect(sent).toHaveText("A dancer.");
  expect(await copies()).toBe(0);
  await expect(page.getByLabel("Look")).toHaveValue("A dancer.");
});

test.describe("on a phone", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("the background tiles sit side by side, every option fits the screen, and a pick shows in the preview", async ({
    page,
  }) => {
    await openDirect(page);

    const backgrounds = lookCatalog.options.filter(({ group }) => group === "background");

    const boxes = await Promise.all(
      backgrounds.map(async (option) => tile(page, option.label).boundingBox()),
    );

    // One row: the same top, side by side.
    expect(new Set(boxes.map((box) => Math.round(box?.y ?? -1))).size).toBe(1);

    for (const option of lookCatalog.options) {
      await expect(tile(page, option.label)).toBeVisible();
    }

    // The experimental groups say so where they are picked.
    await expect(page.getByText("Experimental", { exact: true })).toHaveCount(2);

    const lighting = lookCatalog.options.find(({ group }) => group === "lighting");

    await tile(page, lighting?.label ?? "").click();
    await expect(page.getByLabel("Prompt sent")).toContainText(lighting?.fragment ?? "");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBe(0);
  });
});
