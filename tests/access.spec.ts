import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { type APIRequest, expect, test } from "@playwright/test";

import { accessCode, open, seededResult, storageStatePath } from "./e2e/session.ts";

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

  test("the wizard is open; an upload asks for the code in the dialog, then goes on with every choice kept", async ({
    page,
  }) => {
    const { characterId } = seededResult();
    const uploads: string[] = [];

    page.on("request", (sent) => {
      if (sent.method() === "POST" && new URL(sent.url()).pathname === "/api/uploads") {
        uploads.push(sent.url());
      }
    });

    // A link that keeps a character, as "Same character, new motion" makes one.
    await open(page, `/motionTransfer?step=motion&character=${characterId}`);

    // The samples play without a session.
    const preview = page.getByRole("list", { name: "Motions" }).locator("video").first();

    await expect
      .poll(() => preview.evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThan(0);

    await expect(page.locator('[data-upload-state="idle"]')).toContainText("Needs access code");
    await page.getByLabel("Upload a clip").setInputFiles("fixtures/x.mp4");

    // Asked for the code before anything is sent; the file waits in its tile.
    const dialog = page.getByRole("dialog", { name: "Enter your access code" });

    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-upload-state="needs-code"]')).toContainText("x.mp4");
    expect(uploads).toEqual([]);

    await dialog.getByLabel("Access code").fill("not-the-code");
    await dialog.getByRole("button", { name: "Unlock and upload" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(await page.context().cookies()).toEqual([]);

    await dialog.getByLabel("Access code").fill(accessCode());
    await dialog.getByRole("button", { name: "Unlock and upload" }).click();

    // The same file went up: picked, on the same step with the character still picked.
    await expect(page.getByRole("button", { name: /Your clip/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(dialog).toBeHidden();
    expect(uploads).toHaveLength(1);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/motionTransfer" &&
        url.searchParams.get("step") === "motion" &&
        url.searchParams.get("character") === characterId &&
        /^[0-9a-f-]{36}$/.test(url.searchParams.get("motion") ?? ""),
    );
    await expect(page.getByText("Code active").filter({ visible: true })).toBeVisible();
  });

  test("a clip left waiting for the code uploads once the visitor signs in another way", async ({
    page,
  }) => {
    const uploads: string[] = [];

    page.on("request", (sent) => {
      if (sent.method() === "POST" && new URL(sent.url()).pathname === "/api/uploads") {
        uploads.push(sent.url());
      }
    });

    await open(page, "/motionTransfer");
    await page.getByLabel("Upload a clip").setInputFiles("fixtures/x.mp4");

    const dialog = page.getByRole("dialog", { name: "Enter your access code" });

    // Not now: the file stays in its tile, waiting.
    await dialog.getByRole("button", { name: "Not now" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-upload-state="needs-code"]')).toContainText("x.mp4");

    // Signed in from the header instead, the waiting clip goes up and is picked.
    await page.getByRole("banner").getByRole("button", { name: "Access code" }).click();
    await dialog.getByLabel("Access code").fill(accessCode());
    await dialog.getByRole("button", { name: "Unlock and upload" }).click();
    await expect(page.getByRole("button", { name: /Your clip/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(uploads).toHaveLength(1);
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

    await open(page, `/motionTransfer?motion=${clip}&character=${seededResult().characterId}`);
    await expect(page).toHaveURL(/step=direct/);

    // Picked but not shown: the clip is an upload.
    await expect(page.getByRole("region", { name: "Private choices" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Your shot" })).toContainText("Your clip");

    await page.getByLabel("Look").fill("kept through the code");
    await page.getByRole("button", { name: /Advanced/ }).click();
    await page.getByLabel("Seed", { exact: true }).fill("4242");
    await page.getByRole("button", { name: "Generate" }).click();

    const dialog = page.getByRole("dialog", { name: "Enter your access code" });

    await dialog.getByLabel("Access code").fill(accessCode());
    await dialog.getByRole("button", { name: "Unlock and generate" }).click();

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

    await open(page, `/motionTransfer?step=motion&motion=${clip}`);
    await expect(page.getByRole("button", { name: /Your clip, locked/ })).toBeVisible();

    // The handler's answer over the limit, which the e2e server's high limit never gives here.
    await page.route("**/api/uploads", (route) =>
      route.fulfill({
        json: { error: "Too many uploads. Try again in 42 s.", reason: "rate_limited" },
        status: 429,
      }),
    );

    await page.getByLabel("Upload a clip").setInputFiles("fixtures/x.mp4");

    const dialog = page.getByRole("dialog", { name: "Enter your access code" });

    await dialog.getByLabel("Access code").fill(accessCode());
    await dialog.getByRole("button", { name: "Unlock and upload" }).click();

    // Signed in, the page shows the clip now, and the refusal with it.
    await expect(page.getByRole("button", { name: /Your clip/ }).locator("video")).toHaveCount(1);

    const tile = page.locator("[data-upload-state]");

    await expect(tile).toHaveAttribute("data-reason", "rate_limited");
    await expect(tile.getByRole("alert")).toContainText("Too many uploads");
  });

  test("on a phone, a link that carries the code lands on the builder signed in; reopened, it asks nothing", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });

    const link = `/access?code=${encodeURIComponent(accessCode())}&next=%2Fcharacters%2Fnew`;

    const landed = async () => {
      await expect(page).toHaveURL(
        (url) => url.pathname === "/characters/new" && url.search === "",
      );
      await expect(page.getByRole("heading", { name: "Describe your character" })).toBeVisible();
      await expect(page.getByText("Code active")).toBeVisible();
    };

    await open(page, link);
    await landed();
    expect((await page.context().cookies()).map((cookie) => cookie.name)).toEqual([
      "photon_access",
    ]);

    await open(page, link);
    await landed();

    // A wrong code: the form with the error, still at the builder's `next`, and no session.
    await page.context().clearCookies();
    await page.goto("/access?code=not-the-code&next=%2Fcharacters%2Fnew");
    await expect(page.getByRole("status")).toHaveText("Incorrect access code. Please try again.");
    await expect(page.getByLabel("Access code")).toBeVisible();
    expect(await page.context().cookies()).toEqual([]);
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
