import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { mintCode } from "../../../../tests/temp-database.ts";
import { findAccessCode, findAccessCodeById } from "../../../shared/server/access-codes.ts";
import { createAccessPolicy } from "../../../shared/server/access-policy.ts";
import { database } from "../../../shared/server/db.server.ts";
import { generationAccess } from "../../../shared/server/generation/public-access.ts";
import { assetsDirectory } from "../../../shared/server/paths.ts";
import { createFromUpload, listSampleCharacters } from "../../characters/api.ts";
import {
  draftHref,
  motionTransferDraftSchema,
  snapshotDraft,
  withCharacter,
} from "../../motionTransfer/api.ts";
import { OWN_CLIP } from "../contracts.ts";
import { listExamples, readExampleBySlug } from "../server/catalog.ts";
import { exploreAccess } from "../server/public-access.ts";

const ORIGIN = "https://photon.example";

// What every generation opens, and Explore's declaration, as `src/app/server.ts` composes them.
const policy = createAccessPolicy([generationAccess, exploreAccess]);

const now = () => new Date().toISOString();

/** Stores an asset row (no file: Explore reads rows only) and returns its id and SHA-256. */
function addAsset(
  kind: "image" | "poster" | "video",
  role: "provider_output" | "poster" | "upload",
) {
  const id = randomUUID();
  const sha256 = createHash("sha256").update(id).digest("hex");
  const ext = kind === "video" ? "mp4" : kind === "poster" ? "jpg" : "png";

  database
    .prepare(
      `INSERT INTO assets (id, sha256, kind, role, path, mime, bytes, width, height, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 480, 848, ?)`,
    )
    .run(
      id,
      sha256,
      kind,
      role,
      `${sha256}.${ext}`,
      kind === "video" ? "video/mp4" : "image/png",
      now(),
    );

  return { id, sha256 };
}

const [motion] = database
  .prepare(
    `SELECT motions.slug, motions.title, assets.id, assets.sha256 FROM motions
    JOIN assets ON assets.id = motions.source_asset_id`,
  )
  .all()
  .map((row) => ({
    id: String(row.id),
    sha256: String(row.sha256),
    slug: String(row.slug),
    title: String(row.title),
  }));

const samples = listSampleCharacters();
const [arthur, maya] = samples;

assert.ok(motion && arthur && maya, "The samples are seeded");

type Take = {
  characterId?: string | null;
  drivingSha256?: string;
  outputs?: ("compare" | "poster" | "video")[];
  prerendered?: boolean;
  prompt?: string;
  referenceSha256?: string;
  seed?: number;
  shared?: boolean;
  status?: "done" | "failed";
  workflowId?: string;
};

/**
 * Stores a Motion Transfer generation as finalize leaves one (by default a done, shared,
 * pre-rendered take of Arthur performing the sample motion, with a result and poster), and
 * returns its id, share slug and output assets.
 */
function addTake({
  characterId = arthur?.id ?? null,
  drivingSha256 = motion?.sha256 ?? "",
  outputs = ["video", "poster"],
  prerendered = true,
  prompt = "The character as photographed. Background: a neon-lit city street at night.",
  referenceSha256 = arthur?.image.sha256 ?? "",
  seed = 7,
  shared = true,
  status = "done",
  workflowId = "motion-transfer",
}: Take = {}) {
  const id = randomUUID();
  const slug = shared ? randomUUID().replaceAll("-", "").slice(0, 16) : null;

  const recipe = {
    inputs: { driving_video_sha256: drivingSha256, reference_image_sha256: referenceSha256 },
    models: [{ file: "wan.safetensors", license: "apache-2.0", sha256: "b".repeat(64) }],
    params: { fragment_length: 81, height: 848, prompt, seed, width: 480 },
    target: "cloud",
    workflow: { id: workflowId, sha256: "a".repeat(64), version: 1 },
  };

  database
    .prepare(
      `INSERT INTO generations (id, character_id, workflow_id, workflow_version, recipe,
        recipe_hash, idempotency_key, provider_job_id, target, status, progress, share_slug,
        is_prerendered, created_at, submitted_at, finished_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'cloud', ?, 100, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      characterId,
      workflowId,
      JSON.stringify(recipe),
      createHash("sha256").update(id).digest("hex"),
      randomUUID(),
      `explore-test-${id}`,
      status,
      slug,
      prerendered ? 1 : 0,
      now(),
      now(),
      now(),
    );

  const assets = Object.fromEntries(
    outputs.map((name) => {
      const asset =
        name === "poster" ? addAsset("poster", "poster") : addAsset("video", "provider_output");

      database
        .prepare("INSERT INTO generation_outputs (generation_id, name, asset_id) VALUES (?, ?, ?)")
        .run(id, name, asset.id);

      return [name, asset.id];
    }),
  );

  return { assets, id, slug: slug ?? "" };
}

const curated = addTake();
const notCurated = addTake({ prerendered: false });
const failed = addTake({ status: "failed" });
const unpublished = addTake({ shared: false });
const withoutResult = addTake({ outputs: ["poster"] });
const otherWorkflow = addTake({ workflowId: "character-generation" });

const listedIds = () => new Set(listExamples(ORIGIN).map(({ id }) => id));

test("the gallery lists only curated takes: pre-rendered, done, published Motion Transfer takes with a result", () => {
  const ids = listedIds();

  assert.equal(ids.has(curated.id), true);

  for (const take of [notCurated, failed, unpublished, withoutResult, otherWorkflow]) {
    assert.equal(ids.has(take.id), false);
    assert.equal(readExampleBySlug(take.slug, ORIGIN), null);
  }
});

test("an example names only public media, never a server path", () => {
  const entry = listExamples(ORIGIN).find(({ id }) => id === curated.id);
  const detail = readExampleBySlug(curated.slug, ORIGIN);

  assert.ok(entry && detail);
  assert.equal(detail.result.id, curated.assets.video);
  assert.equal(detail.poster?.id, curated.assets.poster);
  assert.equal(detail.source?.id, motion?.id);
  assert.equal(detail.character?.image?.id, arthur?.image.id);
  assert.equal(detail.title, `${arthur?.title} performs ${motion?.title}`);
  assert.deepEqual(detail.motion, { key: motion?.slug, sample: true, title: motion?.title });
  assert.equal(detail.pageUrl, `${ORIGIN}/r/${curated.slug}`);
  assert.equal(detail.recipeUrl, `/api/generations/${curated.id}/recipe.json`);

  // Each file is a shared take's output (`generationAccess`), the sample motion's clip or a sample
  // character's image, which their features open to anyone; the browser test loads each one
  // without a session.
  const sampleFiles = new Set([motion?.id, ...samples.map(({ image }) => image.id)]);

  const named = [
    entry.result,
    entry.poster,
    detail.result,
    detail.poster,
    detail.compare,
    detail.source,
    detail.character?.image,
  ].flatMap((asset) => (asset ? [asset.id] : []));

  assert.equal(named.length, 6);

  for (const id of named) {
    assert.equal(policy.isPublicAsset(id) || sampleFiles.has(id), true, `asset ${id} is public`);
  }

  for (const answer of [entry, detail]) {
    const text = JSON.stringify(answer);

    assert.equal(text.includes('"path"'), false);
    assert.equal(text.includes(assetsDirectory()), false);
  }
});

test("the readable recipe and look come from the published recipe; looks are keyed by their exact text", () => {
  const detail = readExampleBySlug(curated.slug, ORIGIN);

  assert.ok(detail);
  assert.equal(
    detail.look.text,
    "The character as photographed. Background: a neon-lit city street at night.",
  );
  assert.equal(detail.look.label, "The character as photographed.");
  assert.match(detail.look.key, /^[a-f0-9]{12}$/);
  assert.equal(detail.seed, 7);
  assert.deepEqual(
    { ...detail.recipe, models: detail.recipe.models.map(({ file }) => file) },
    {
      fragmentLength: 81,
      height: 848,
      models: ["wan.safetensors"],
      target: "cloud",
      width: 480,
      workflow: { id: "motion-transfer", sha256: "a".repeat(64), version: 1 },
    },
  );

  const other = addTake({ prompt: "A plain studio look." });
  const looks = new Map(listExamples(ORIGIN).map(({ id, look }) => [id, look.key]));

  assert.notEqual(looks.get(other.id), looks.get(curated.id));
});

test("Make this with my character is a validated draft: from the take, its sample motion, no character, no step", () => {
  const { remix } = readExampleBySlug(curated.slug, ORIGIN) ?? {};

  assert.ok(remix);
  assert.deepEqual(remix.draft, { from: curated.id, motion: motion?.id });
  assert.equal(remix.motionKept, true);
  assert.equal(remix.href, draftHref({ from: curated.id, motion: motion?.id }));

  // The wizard reads the link back as this draft, and the shot keeps it with a character picked.
  const search = Object.fromEntries(new URL(remix.href, ORIGIN).searchParams);

  assert.equal(new URL(remix.href, ORIGIN).pathname, "/motionTransfer");
  assert.deepEqual(motionTransferDraftSchema.parse(search), {
    from: curated.id,
    motion: motion?.id,
  });
  assert.deepEqual(withCharacter(snapshotDraft(remix.draft), maya?.id ?? ""), {
    character: maya?.id,
    from: curated.id,
    motion: motion?.id,
  });
});

test("a take driven by someone's own clip lists without it: no source, motion left to pick, look and seed kept by from", () => {
  const upload = addAsset("video", "upload");
  const own = addTake({ drivingSha256: upload.sha256 });
  const detail = readExampleBySlug(own.slug, ORIGIN);

  assert.ok(detail);
  assert.equal(detail.source, null);
  assert.deepEqual(detail.motion, { key: OWN_CLIP, sample: false, title: "Their own clip" });
  assert.deepEqual(detail.remix.draft, { from: own.id });
  assert.equal(detail.remix.motionKept, false);
  assert.equal(JSON.stringify(detail).includes(upload.id), false);
  assert.equal(JSON.stringify(detail).includes(upload.sha256), false);
});

test("an uploaded character never shows: no title, no image; a sample's image only when the take used it", () => {
  const photo = addAsset("image", "upload");

  const { character } = createFromUpload({
    assetId: photo.id,
    consentAt: now(),
    title: "My private likeness",
  });

  const private_ = addTake({ characterId: character.id, referenceSha256: photo.sha256 });
  const detail = readExampleBySlug(private_.slug, ORIGIN);

  assert.ok(detail);
  assert.equal(detail.character, null);
  assert.equal(detail.characterTitle, null);
  assert.equal(detail.title, `A character performs ${motion?.title}`);
  assert.equal(JSON.stringify(detail).includes(photo.id), false);
  assert.equal(JSON.stringify(detail).includes("My private likeness"), false);

  // A sample re-rendered since: its name shows, the image the take used is no longer its own.
  const stale = addTake({ referenceSha256: "c".repeat(64) });

  assert.deepEqual(readExampleBySlug(stale.slug, ORIGIN)?.character, {
    image: null,
    title: arthur?.title,
  });
});

test("a removed example and a malformed slug have no page", () => {
  const removed = addTake();

  assert.notEqual(readExampleBySlug(removed.slug, ORIGIN), null);
  database.prepare("UPDATE generations SET is_prerendered = 0 WHERE id = ?").run(removed.id);
  assert.equal(readExampleBySlug(removed.slug, ORIGIN), null);
  assert.equal(listedIds().has(removed.id), false);

  for (const slug of [
    "",
    "nope",
    "../../etc/passwd",
    `${curated.slug}0`,
    curated.slug.toUpperCase(),
  ]) {
    assert.equal(readExampleBySlug(slug, ORIGIN), null);
  }
});

test("browsing and opening the remake stores nothing and counts against no access code", () => {
  const code = findAccessCode(mintCode(5));

  assert.ok(code);

  const count = () => database.prepare("SELECT count(*) AS n FROM generations").get()?.n;
  const before = count();

  for (const entry of listExamples(ORIGIN)) {
    readExampleBySlug(entry.slug, ORIGIN);
  }

  assert.equal(count(), before);
  assert.equal(findAccessCodeById(code.id)?.used, 0);
});

test("Explore's pages and server functions are open without the access code; nothing else of it is", () => {
  assert.equal(policy.isPublicRequest("GET", "/explore"), true);
  assert.equal(policy.isPublicRequest("GET", "/explore/"), true);
  assert.equal(policy.isPublicRequest("GET", `/explore/${curated.slug}`), true);
  assert.equal(policy.isPublicRequest("POST", "/explore"), false);
  assert.equal(policy.isPublicRequest("GET", `/explore/${curated.slug}/more`), false);
  assert.equal(policy.isIndexable(`/explore/${curated.slug}`), true);
  assert.equal(
    policy.isPublicServerFn("src/features/explore/explore.functions.ts#loadExplore"),
    true,
  );
  assert.equal(
    policy.isPublicServerFn("src/features/explore/explore.functions.ts#loadExample"),
    true,
  );
  assert.equal(policy.isPublicServerFn("src/features/explore/explore.functions.ts#other"), false);
});
