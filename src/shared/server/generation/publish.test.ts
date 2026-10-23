import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { mintCode } from "../../../../tests/temp-database.ts";
import { imageDefinition } from "../../../../tests/test-image-workflow.ts";
import { isPublicRequest } from "../../../app/server.ts";
import { shareOriginSchema } from "../../contracts.ts";
import { findAccessCode } from "../access-codes.ts";
import { findAsset } from "../assets.ts";
import { database } from "../db.server.ts";
import { handleShareOrigin } from "../public-origin.ts";
import { workflows } from "./definition.ts";
import { GenerateError } from "./errors.ts";
import { findGeneration, isSharedOutput, publishGeneration, readOutputs } from "./generations.ts";
import { handlePublish } from "./http.ts";
import { readGenerationShare } from "./pages.ts";
import { readGeneration, submit } from "./service.ts";

// `comfyProvider` (the default of every call below) is the fake, on a self-hosted dead port.
process.env.COMFY_PROVIDER = "fake";

process.env.COMFY_FAKE_STEP_MS = "0";

process.env.COMFY_API_KEY = "";

process.env.COMFY_PROXY_TOKEN = "";

process.env.COMFY_BASE_URL = "http://127.0.0.1:1";

process.env.IN_FLIGHT_MAX = "1000";

const scope = { free: () => false, session: { codeId: findAccessCode(mintCode(100))?.id ?? "" } };

/** The test image workflow, as a workflow whose generations are published only on request. */
const reviewedDefinition: typeof imageDefinition = {
  ...imageDefinition,
  id: "test-image-reviewed",
  prepareRecipe: (input, context) => {
    const { recipe } = imageDefinition.prepareRecipe(input, context);

    return { recipe: { ...recipe, workflow: { ...recipe.workflow, id: "test-image-reviewed" } } };
  },
  publish: "on-request",
};

workflows.register(reviewedDefinition);

/** A done generation of `definition` for `prompt`, through the fake provider; its id. */
async function done(definition: typeof imageDefinition, prompt: string) {
  const { id } = await submit(definition, { prompt }, { scope });

  assert.equal((await readGeneration(id))?.status, "done");

  return id;
}

// First: the fake provider's images are one file, which any published generation makes public.
test("a workflow that publishes on request keeps a done generation private until it is published, once", async () => {
  const id = await done(reviewedDefinition, "A reviewed portrait");
  const image = findAsset(readOutputs(id)[0]?.asset.id ?? "");

  assert.ok(image);
  assert.equal(findGeneration(id)?.share_slug, null);
  assert.equal(isSharedOutput(image), false);
  assert.equal(isPublicRequest("GET", `/media/${image.id}.png`), false);

  const slug = publishGeneration(id);

  assert.match(slug, /^[0-9a-f]{16}$/);
  assert.equal(findGeneration(id)?.share_slug, slug);
  assert.equal(isSharedOutput(image), true);
  assert.equal(isPublicRequest("GET", `/media/${image.id}.png`), true);
  assert.equal(readGenerationShare(slug, "https://photon.example")?.outputs[0]?.asset.id, image.id);
  // Idempotent: the same slug again.
  assert.equal(publishGeneration(id), slug);
});

test("a workflow that publishes on done does so as before; publishing refuses what it cannot publish", async () => {
  const id = await done(imageDefinition, "A portrait published on done");
  const slug = findGeneration(id)?.share_slug;

  assert.match(slug ?? "", /^[0-9a-f]{16}$/);
  // Its slug, unchanged.
  assert.equal(publishGeneration(id), slug);

  const refused = (target: string, status: number, reason: string) =>
    assert.throws(
      () => publishGeneration(target),
      (error) =>
        error instanceof GenerateError && error.status === status && error.reason === reason,
    );

  refused(crypto.randomUUID(), 404, "not_found");

  // A generation of a workflow that publishes on done is never published on request.
  database.prepare("UPDATE generations SET share_slug = NULL WHERE id = ?").run(id);
  refused(id, 409, "not_publishable");

  const queued = await submit(reviewedDefinition, { prompt: "Not done yet" }, { scope });

  refused(queued.id, 409, "not_done");
  assert.equal(findGeneration(queued.id)?.share_slug, null);
});

test("a share link starts with PUBLIC_APP_URL when the server sets it, else the request's origin, for a new publish and an old one alike", async () => {
  const request = new Request("http://internal:3000/api/share-origin");
  const before = process.env.PUBLIC_APP_URL;

  const origin = async () =>
    shareOriginSchema.parse(await handleShareOrigin(request).json()).origin;

  delete process.env.PUBLIC_APP_URL;
  assert.equal(await origin(), "http://internal:3000");
  process.env.PUBLIC_APP_URL = "https://photon.example";

  try {
    const id = await done(reviewedDefinition, "A portrait behind a proxy");

    const answer = await handlePublish(
      new Request(`http://internal:3000/api/generations/${id}/publish`, { method: "POST" }),
      id,
    ).json();

    assert.equal(answer.url, `https://photon.example/r/${answer.share_slug}`);
    // What a page puts before the slug of a generation published earlier: the same URL.
    assert.equal(`${await origin()}/r/${answer.share_slug}`, answer.url);
  } finally {
    if (before === undefined) {
      delete process.env.PUBLIC_APP_URL;
    } else {
      process.env.PUBLIC_APP_URL = before;
    }
  }

  // Not public: the access guard asks for the code first.
  assert.equal(isPublicRequest("GET", "/api/share-origin"), false);
});
