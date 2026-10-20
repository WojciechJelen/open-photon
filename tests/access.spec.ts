import { expect, test } from "@playwright/test";

import { accessCode, open } from "./e2e/session.ts";

test.describe("without a session", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the picker is open; an upload asks for the code inline, then goes on with every choice kept", async ({
    page,
  }) => {
    const uploads: string[] = [];

    page.on("request", (sent) => {
      if (sent.method() === "POST" && new URL(sent.url()).pathname === "/api/uploads") {
        uploads.push(sent.url());
      }
    });

    await open(page, "/");

    // The samples play without a session.
    const preview = page.getByRole("list", { name: "Sample motions" }).locator("video").first();

    await expect
      .poll(() => preview.evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "Placeholder blue" }).click();
    await expect(page).toHaveURL(/\?character=/);

    const character = new URL(page.url()).searchParams.get("character");

    await page.getByLabel("Or upload your own clip").setInputFiles("fixtures/x.mp4");

    // Asked for the code before anything is sent.
    const form = page.getByRole("form", { name: "Access code" });

    await expect(form).toBeVisible();
    expect(uploads).toEqual([]);

    await form.getByLabel("Access code").fill("not-the-code");
    await form.getByRole("button", { name: "Continue" }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    expect(await page.context().cookies()).toEqual([]);

    await form.getByLabel("Access code").fill(accessCode());
    await form.getByRole("button", { name: "Continue" }).click();

    // The same file went up: ready and chosen, on the same page with the character still picked.
    await expect(page.getByRole("status")).toHaveAttribute("data-state", "ready");
    await expect(form).toHaveCount(0);
    expect(uploads).toHaveLength(1);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/" &&
        url.searchParams.get("character") === character &&
        /^[0-9a-f-]{36}$/.test(url.searchParams.get("motion") ?? ""),
    );
    await expect(page.getByRole("group", { name: "Chosen motion" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Chosen character" })).toBeVisible();
  });
});
