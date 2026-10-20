import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { characterSchema } from "../src/lib/contracts.ts";
import { open, seededResult } from "./e2e/session.ts";

/** No cookies: a visitor without the access code, such as a social site's crawler. */
const anonymous = { cookies: [], origins: [] };

test("the share page opens without the code, its Open Graph tags in the server-rendered HTML", async ({
  baseURL,
  playwright,
}) => {
  const { finalAssetId, shareSlug } = seededResult();
  const visitor = await playwright.request.newContext({ baseURL, storageState: anonymous });

  // Raw HTML, no JavaScript: what a crawler reads.
  const page = await visitor.get(`/r/${shareSlug}`, { maxRedirects: 0 });

  expect(page.status()).toBe(200);
  // Search engines may index share pages and the files they show, nothing else.
  expect(page.headers()["x-robots-tag"]).toBeUndefined();

  const html = await page.text();

  const tags = Object.fromEntries(
    [...html.matchAll(/<meta property="(og:[a-z:_]+)" content="([^"]*)"/g)].map(
      ([, property, content]) => [property, content],
    ),
  );

  const origin = new URL(baseURL ?? "").origin;

  expect(tags["og:title"]).toBeTruthy();
  expect(tags["og:url"]).toBe(`${origin}/r/${shareSlug}`);
  expect(tags["og:video"]).toBe(`${origin}/media/${finalAssetId}.mp4`);
  expect(tags["og:video:type"]).toBe("video/mp4");
  expect(tags["og:image"]).toMatch(new RegExp(`^${origin}/media/[0-9a-f-]{36}\\.jpg$`));
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');

  // The media the tags name open for the same visitor.
  const video = await visitor.get(tags["og:video"] ?? "", { headers: { Range: "bytes=0-99" } });

  expect(video.status()).toBe(206);
  expect(video.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(video.headers()["x-robots-tag"]).toBeUndefined();
  expect((await visitor.get("/")).headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect((await visitor.get(tags["og:image"] ?? "")).status()).toBe(200);

  expect((await visitor.get("/r/does-not-exist")).status()).toBe(404);
  await visitor.dispose();
});

test("everything else stays behind the access code", async ({ baseURL, playwright, request }) => {
  // A character photo uploaded with a session: never public, even once its generation is shared.
  const uploaded = await request.post("/api/characters", {
    multipart: {
      consent: "true",
      image: {
        buffer: readFileSync("fixtures/wan/reference.png"),
        mimeType: "image/png",
        name: "reference.png",
      },
    },
  });

  expect(uploaded.ok()).toBe(true);

  const { image_asset_id } = characterSchema.parse(await uploaded.json());
  const { id } = seededResult();
  const visitor = await playwright.request.newContext({ baseURL, storageState: anonymous });

  expect((await visitor.get(`/media/${image_asset_id}.png`)).status()).toBe(401);
  expect((await request.get(`/media/${image_asset_id}.png`)).headers()["x-robots-tag"]).toBe(
    "noindex, nofollow",
  );
  expect((await request.get(`/g/${id}`)).headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect((await visitor.get(`/api/generations/${id}`)).status()).toBe(401);

  const result = await visitor.get(`/g/${id}`, {
    headers: { Accept: "text/html" },
    maxRedirects: 0,
  });

  expect(result.headers().location).toBe(`/access?next=${encodeURIComponent(`/g/${id}`)}`);
  await visitor.dispose();
});

test("an anonymous visitor sees the result and the source, and the motion link starts the flow", async ({
  browser,
}) => {
  const { shareSlug, sourceAssetId } = seededResult();
  const context = await browser.newContext({ storageState: anonymous });
  const page = await context.newPage();

  await open(page, `/r/${shareSlug}`);

  for (const label of ["Result", "Source motion"]) {
    const video = page.getByLabel(label, { exact: true });

    await expect(video).toHaveJSProperty("muted", true);
    await expect(video).toHaveJSProperty("loop", true);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThan(0);
  }

  await page.getByRole("link", { name: "Use this motion with my character" }).click();

  // The picker is open without the code: `/` with the shared clip chosen, playable.
  await expect(page).toHaveURL(
    (url) => url.pathname === "/" && url.searchParams.get("motion") === sourceAssetId,
  );

  const chosen = page.getByRole("group", { name: "Chosen motion" }).locator("video");

  await expect
    .poll(() => chosen.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThan(0);
  await context.close();
});

test("a done generation's page shows its share link, which opens the share page", async ({
  page,
}) => {
  const { id, shareSlug, sourceAssetId } = seededResult();

  await open(page, `/g/${id}`);

  const link = page.getByLabel("Share link");

  await expect(link).toHaveValue(new RegExp(`/r/${shareSlug}$`));
  await page.getByRole("link", { name: "Open share page" }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${shareSlug}$`));

  // Signed in, the motion link opens `/` with the motion chosen.
  await page.locator("html[data-hydrated]").waitFor();
  await page.getByRole("link", { name: "Use this motion with my character" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/" && url.searchParams.get("motion") === sourceAssetId,
  );
  await expect(page.getByRole("group", { name: "Chosen motion" })).toBeVisible();
});
