import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { type APIRequest, expect, test } from "@playwright/test";

import { accessCode, open, storageStatePath } from "./e2e/session.ts";

/** Uploads `fixtures/x.mp4` (not a sample, so only a session sees it) with the run's session. */
async function uploadPrivateClip(request: APIRequest, baseURL: string | undefined) {
  const signedIn = await request.newContext({ baseURL, storageState: storageStatePath() });

  const response = await signedIn.post("/api/uploads", {
    multipart: {
      file: { buffer: readFileSync("fixtures/x.mp4"), mimeType: "video/mp4", name: "x.mp4" },
    },
  });

  expect(response.ok()).toBe(true);

  const { id } = await response.json();

  await signedIn.dispose();

  return String(id);
}

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

  test("a link to a private clip keeps it: Generate asks for the code, then starts with every option", async ({
    baseURL,
    page,
    playwright,
  }) => {
    const clip = await uploadPrivateClip(playwright.request, baseURL);
    const sent: unknown[] = [];

    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/generate") {
        sent.push(request.postDataJSON());
      }
    });

    await open(page, `/?motion=${clip}`);
    await page.getByRole("button", { name: "Placeholder blue" }).click();
    await expect(page).toHaveURL(new RegExp(`motion=${clip}`));

    // Chosen but not shown: the clip is an upload.
    const motion = page.getByRole("group", { name: "Chosen motion" });

    await expect(motion).toContainText("your own clip");
    await expect(motion.locator("video")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Private choices" })).toBeVisible();

    await page.getByLabel("Appearance and background").fill("kept through the code");
    await page.getByRole("button", { name: "Advanced" }).click();
    await page.getByLabel("Seed").fill("4242");
    await page.getByRole("button", { name: "Generate" }).click();

    const form = page
      .getByRole("region", { name: "3. Generate" })
      .getByRole("form", { name: "Access code" });

    await form.getByLabel("Access code").fill(accessCode());
    await form.getByRole("button", { name: "Continue" }).click();

    // The same choices went again, and the generation opened (Comfy is at a dead port).
    await expect(page).toHaveURL(/\/g\/[0-9a-f-]{36}$/);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toMatchObject({
      motion_asset_id: clip,
      prompt: "kept through the code",
      seed: 4242,
    });
  });

  test("on a link to a private clip, an upload refused after the code stays shown", async ({
    baseURL,
    page,
    playwright,
  }) => {
    const clip = await uploadPrivateClip(playwright.request, baseURL);

    await open(page, `/?motion=${clip}`);

    // The handler's answer over the limit, which the e2e server's high limit never gives here.
    await page.route("**/api/uploads", (route) =>
      route.fulfill({
        json: { error: "Too many uploads. Try again in 42 s.", reason: "rate_limited" },
        status: 429,
      }),
    );

    const section = page.getByRole("region", { name: "1. Motion" });

    await section.getByLabel("Or upload your own clip").setInputFiles("fixtures/x.mp4");

    const form = section.getByRole("form", { name: "Access code" });

    await form.getByLabel("Access code").fill(accessCode());
    await form.getByRole("button", { name: "Continue" }).click();

    // Signed in, the page shows the clip now, and the refusal with it.
    await expect(
      section.getByRole("group", { name: "Chosen motion" }).locator("video"),
    ).toHaveCount(1);
    await expect(section.getByRole("status")).toHaveAttribute("data-reason", "rate_limited");
    await expect(section.getByRole("status")).not.toBeEmpty();
  });
});

test("uploads are limited at every URL the router sends to them: any letter case, a trailing slash", async ({
  page,
}) => {
  // A code of its own, so the run's code keeps its tokens.
  const code = execFileSync(process.execPath, ["scripts/mint-code.mjs", "aliases", "1"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_PATH: process.env.E2E_DATABASE_PATH },
  }).trim();

  await page.context().clearCookies();
  expect((await page.request.post("/api/session", { data: { code } })).status()).toBe(204);

  const aliases = [
    "/api/uploads/",
    "/API/Uploads",
    "/Api/Characters/",
    `/api/assets/${crypto.randomUUID()}/TRIM/`,
  ];

  // Only aliases, from empty bodies, until the limit (1000 a minute here, refilling as they go)
  // refuses one; through a bypass none ever would.
  let refused;

  for (let sent = 0; sent < 3000 && !refused; sent += 50) {
    const answers = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        page.request.post(aliases[index % aliases.length] ?? "", { data: "" }),
      ),
    );

    refused = answers.find((answer) => answer.status() === 429);

    expect(answers.every((answer) => [400, 404, 415, 429].includes(answer.status()))).toBe(true);
  }

  expect(refused).toBeDefined();
  expect(await refused?.json()).toMatchObject({ reason: "rate_limited" });
});
