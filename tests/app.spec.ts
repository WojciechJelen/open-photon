import { expect, test } from "@playwright/test";

import { accessCode, open, seededResult } from "./e2e/session.ts";

test("the studio home features Motion Transfer and links its live character tools, and the navigation shows the planned ones disabled", async ({
  page,
}) => {
  await open(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Make the shot.");

  const tools = page.locator("#tools");

  // The featured card is one link into the wizard.
  await tools.getByRole("link", { name: /Open Motion Transfer/ }).click();
  await expect(page).toHaveURL(/\/motionTransfer/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pick a motion");

  await open(page, "/");
  await expect(page.getByRole("list", { name: "Coming soon" })).toHaveCount(0);
  await expect(tools.getByText("Soon", { exact: true })).toHaveCount(0);

  // The home has no Soon cards; the main navigation shows every planned category and tool, but
  // disabled: a planned category is a disabled button, a planned tool a disabled menu item that
  // links nowhere (the menus render outside the nav), and each shipped tool is a link. Explore is
  // one page, so a plain link.
  const navigation = page.getByRole("navigation", { name: "Main" });

  await expect(navigation.getByRole("button")).toHaveText([
    "Image",
    "Video",
    "Audio (coming soon)",
    "Library",
  ]);
  await expect(navigation.getByRole("button", { name: "Audio" })).toBeDisabled();
  await expect(navigation.getByRole("link", { exact: true, name: "Explore" })).toHaveAttribute(
    "href",
    "/explore",
  );

  for (const [label, shipped, planned] of [
    [
      "Image",
      [
        ["Create character", "/characters/new"],
        ["Product Studio", "/product-studio"],
      ],
      [],
    ],
    [
      "Video",
      [
        ["Motion Transfer", "/motionTransfer"],
        ["Motion presets", "/presets"],
      ],
      ["Look & lighting", "Batch variations"],
    ],
    ["Library", [["Characters", "/characters"]], []],
  ] as const) {
    await expect(navigation.getByRole("button", { name: label })).toBeEnabled();
    await navigation.getByRole("button", { name: label }).click();

    const menu = page.getByRole("menu");

    await expect(menu.getByRole("menuitem")).toHaveCount(shipped.length + planned.length);

    for (const [name, path] of shipped) {
      const item = menu.getByRole("menuitem", { name });

      await expect(item).toHaveAttribute("href", path);
      await expect(item).not.toHaveAttribute("aria-disabled");
      await expect(item).not.toContainText("Soon");
    }

    for (const name of planned) {
      const item = menu.getByRole("menuitem", { name });

      await expect(item).toBeVisible();
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).not.toHaveAttribute("href");
      await expect(item.locator("a")).toHaveCount(0);
      await expect(item).toContainText("Soon");
    }

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }

  const cards = page.getByRole("list", { name: "Character tools" }).getByRole("listitem");

  await expect(cards).toHaveCount(3);

  for (const [name, path] of [
    ["Describe a character", "/characters/new"],
    ["Character library", "/characters"],
    ["Product Studio", "/product-studio"],
  ] as const) {
    const card = cards.filter({ has: page.getByRole("heading", { name }) });

    await expect(card).toContainText("Live");
    await expect(card.getByRole("link")).toHaveAttribute("href", path);
  }

  await expect(page.getByText("Built open")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("MIT licensed");
});

test("no page scrolls sideways, on a phone or a desktop", async ({ page }) => {
  const { id, shareSlug } = seededResult();

  for (const width of [390, 1440]) {
    await page.setViewportSize({ height: 900, width });

    for (const path of ["/", "/motionTransfer", `/g/${id}`, `/r/${shareSlug}`]) {
      await open(page, path);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        `${path} at ${width} px`,
      ).toBeLessThanOrEqual(0);
    }
  }
});

test("a button reached with the keyboard shows its focus ring", async ({ page }) => {
  await open(page, "/");

  // Tab from the top of the page to the first button (the main navigation's first category).
  for (let step = 0; step < 20; step += 1) {
    await page.keyboard.press("Tab");

    if (await page.evaluate(() => document.activeElement?.matches('button[data-slot="button"]'))) {
      break;
    }
  }

  const ring = await page.evaluate(() => {
    const focused = document.activeElement;

    if (!(focused instanceof HTMLElement) || !focused.matches(":focus-visible")) {
      return null;
    }

    const style = getComputedStyle(focused);

    return { style: style.outlineStyle, width: style.outlineWidth };
  });

  expect(ring).toEqual({ style: "solid", width: "2px" });
});

test.describe("without a session", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a generation's page asks for the code, admits the right one only, then opens", async ({
    page,
  }) => {
    const asked = `/g/${seededResult().id}`;

    await page.goto(asked);
    await expect(page).toHaveURL(/\/access\?next=/);
    await page.getByLabel("Access code").fill("not-the-code");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/access\?next=/);
    expect(await page.context().cookies()).toEqual([]);
    await page.getByLabel("Access code").fill(accessCode());
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(asked);
    await expect(page.getByRole("status", { name: "Generation status" })).toBeVisible();
  });
});

test("generation reads reject invalid and missing ids", async ({ request }) => {
  const missing = crypto.randomUUID();

  expect((await request.get("/api/generations/not-a-uuid")).status()).toBe(400);
  expect((await request.get("/api/generations/not-a-uuid/events")).status()).toBe(400);
  expect((await request.get(`/api/generations/${missing}`)).status()).toBe(404);
  expect((await request.get(`/api/generations/${missing}/events`)).status()).toBe(404);
});
