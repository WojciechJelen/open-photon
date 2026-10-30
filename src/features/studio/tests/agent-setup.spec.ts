import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { open } from "../../../../tests/e2e/session.ts";

const instructions = readFileSync(new URL("../../../../SETUP.md", import.meta.url), "utf8");

test.use({ storageState: { cookies: [], origins: [] } });

test("a visitor can read the canonical guide and copy its complete contents", async ({
  page,
  request,
}) => {
  const guide = await request.get("/setup.md");

  expect(guide.status()).toBe(200);
  expect(guide.headers()["content-type"]).toContain("text/plain");
  expect(await guide.text()).toBe(instructions);
  expect((await request.head("/setup.md")).status()).toBe(200);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, "/");
  await page.getByRole("link", { name: "Run it yourself", exact: true }).click();
  await expect(page).toHaveURL(/#self-host$/);

  const setup = page.getByRole("region", { name: "Run Open Photon on your own account." });

  await expect(setup.getByRole("link", { name: "Read setup.md" })).toHaveAttribute(
    "href",
    "/setup.md",
  );
  await setup.getByRole("button", { name: "Copy agent setup instructions" }).click();
  await expect(setup.getByRole("status")).toHaveText(
    "Setup instructions copied. Paste them into your coding agent.",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(instructions);
});

test("a browser that denies clipboard writes offers the full guide for manual copying", async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 390 });
  await open(page, "/");

  const session = await page.context().newCDPSession(page);
  const { targetInfo } = await session.send("Target.getTargetInfo");

  await session.send("Browser.setPermission", {
    browserContextId: targetInfo.browserContextId,
    origin: new URL(page.url()).origin,
    permission: { name: "clipboard-write" },
    setting: "denied",
  });

  const setup = page.getByRole("region", { name: "Run Open Photon on your own account." });

  await setup.getByRole("button", { name: "Copy agent setup instructions" }).click();
  await expect(setup.getByRole("status")).toContainText("copy them by hand");

  const manual = setup.getByRole("textbox", { name: "Setup instructions" });

  await expect(manual).toHaveValue(instructions);
  await manual.focus();
  expect(
    await manual.evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([0, instructions.length]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});

test("an unavailable guide never reports a successful copy", async ({ page }) => {
  await page.route("**/setup.md", (route) =>
    route.fulfill({ contentType: "text/plain", status: 503, body: "Unavailable" }),
  );
  await open(page, "/");

  const setup = page.getByRole("region", { name: "Run Open Photon on your own account." });

  await expect(setup.getByRole("status")).toContainText("Instructions could not load");
  await expect(setup.getByRole("button", { name: "Copy agent setup instructions" })).toBeDisabled();
  await expect(setup.getByRole("link", { name: "Read setup.md" })).toHaveAttribute(
    "href",
    "/setup.md",
  );
});
