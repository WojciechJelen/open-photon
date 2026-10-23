import { readFileSync } from "node:fs";

import { type APIRequestContext, expect, test } from "@playwright/test";

import { sampleCharacter } from "../../../../tests/e2e/session.ts";
import { characterSummarySchema } from "../index.ts";

/** No cookies: a visitor without the access code. */
const anonymous = { cookies: [], origins: [] };

/**
 * Uploads a photo with consent, as the picker does; the stored character. Not the picker's
 * reference photo, which `character.spec.ts` expects to upload as new.
 */
async function upload(request: APIRequestContext) {
  const response = await request.post("/api/characters", {
    multipart: {
      consent: "true",
      image: {
        buffer: readFileSync("tests/fixtures/fake-output.png"),
        mimeType: "image/png",
        name: "photo.png",
      },
    },
  });

  expect(response.ok()).toBe(true);

  return characterSummarySchema.parse(await response.json());
}

test("PATCH /api/characters/:id renames and (un)favorites with a session, and only with one", async ({
  baseURL,
  playwright,
  request,
}) => {
  const character = await upload(request);

  const patch = (id: string, data: Record<string, boolean | string>) =>
    request.patch(`/api/characters/${id}`, { data });

  const renamed = await patch(character.id, { title: "  Stage name  " });

  expect(renamed.status()).toBe(200);
  expect(characterSummarySchema.parse(await renamed.json()).title).toBe("Stage name");

  const marked = characterSummarySchema.parse(
    await (await patch(character.id, { favorite: true })).json(),
  );

  expect(marked.favorite_at).not.toBeNull();
  expect(marked.title).toBe("Stage name");

  const unmarked = await patch(character.id, { favorite: false, title: "Back again" });

  expect(characterSummarySchema.parse(await unmarked.json())).toMatchObject({
    favorite_at: null,
    title: "Back again",
  });

  const malformed: Record<string, boolean | string>[] = [
    {},
    { title: "" },
    { favorite: "yes" },
    { other: true },
  ];

  for (const body of malformed) {
    expect((await patch(character.id, body)).status(), JSON.stringify(body)).toBe(400);
  }

  expect((await patch(crypto.randomUUID(), { favorite: true })).status()).toBe(404);
  expect((await patch("not-an-id", { favorite: true })).status()).toBe(404);

  const sample = sampleCharacter();
  const retitled = await patch(sample.id, { favorite: true, title: "Mine now" });

  expect(retitled.status()).toBe(409);
  expect((await retitled.json()).reason).toBe("sample");
  expect((await patch(sample.id, { favorite: true })).status()).toBe(200);
  expect((await patch(sample.id, { favorite: false })).status()).toBe(200);

  const visitor = await playwright.request.newContext({ baseURL, storageState: anonymous });

  expect(
    (await visitor.patch(`/api/characters/${character.id}`, { data: { favorite: true } })).status(),
  ).toBe(401);
  await visitor.dispose();
});

test("a sample character's image is public; an uploaded likeness needs a session", async ({
  baseURL,
  playwright,
  request,
}) => {
  const { image_asset_id } = await upload(request);
  const { imageAssetId } = sampleCharacter();
  const visitor = await playwright.request.newContext({ baseURL, storageState: anonymous });

  expect((await visitor.get(`/media/${imageAssetId}.png`)).status()).toBe(200);
  expect((await visitor.get(`/media/${image_asset_id}.png`)).status()).toBe(401);
  expect((await request.get(`/media/${image_asset_id}.png`)).status()).toBe(200);
  await visitor.dispose();
});
