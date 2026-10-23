import { createHash } from "node:crypto";

import { z } from "zod";

import { assetSchema } from "../../../shared/contracts.ts";
import { findAsset } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";
import { readGenerationShare } from "../../../shared/server/generation/pages.ts";
import { getCharacter, visibleCharacter } from "../../characters/api.ts";
import { draftHref, parseDraft } from "../../motionTransfer/api.ts";
import {
  type ExploreDetail,
  exploreDetailSchema,
  type ExploreEntry,
  exploreEntrySchema,
  OWN_CLIP,
} from "../contracts.ts";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * What Explore reads of a Motion Transfer recipe as its share page publishes it
 * (`readGenerationShare`, the workflow's `shareRecipe`): the inputs' hashes, the direction and
 * size, the workflow and model pins, the target. Members it does not read are ignored, so a
 * recipe that gains one still shows; one without these is not an example.
 */
const publishedRecipeSchema = z.object({
  inputs: z.object({
    driving_video_sha256: sha256Schema,
    reference_image_sha256: sha256Schema,
  }),
  models: z.array(z.object({ file: z.string(), license: z.string(), sha256: sha256Schema })),
  params: z.object({
    fragment_length: z.int(),
    height: z.int(),
    prompt: z.string(),
    seed: z.int().nonnegative(),
    width: z.int(),
  }),
  target: z.enum(["cloud", "selfhost"]),
  workflow: z.object({ id: z.string(), sha256: sha256Schema, version: z.int() }),
});

const exampleRowSchema = z.object({
  character_id: z.string().nullable(),
  id: z.uuid(),
  motion_slug: z.string().nullable(),
  motion_title: z.string().nullable(),
  share_slug: z.string(),
  source_id: z.string().nullable(),
});

type ExampleRow = z.output<typeof exampleRowSchema>;

/**
 * The curated examples: the pre-rendered takes (`is_prerendered`, DEV-280's sample matrix, marked
 * by `scripts/prerender-samples.mjs`) that are done Motion Transfer generations with a share page
 * and a result, with the sample motion whose clip drove each (none for another clip). A take
 * someone made is published as it becomes done, but it is not curated, so it is never listed.
 */
const examplesQuery = `SELECT generations.id, generations.share_slug, generations.character_id,
    source.id AS source_id, motions.slug AS motion_slug, motions.title AS motion_title
  FROM generations
  LEFT JOIN assets AS source
    ON source.sha256 = generations.recipe ->> '$.inputs.driving_video_sha256'
  LEFT JOIN motions ON motions.source_asset_id = source.id
  WHERE generations.is_prerendered = 1 AND generations.status = 'done'
    AND generations.workflow_id = 'motion-transfer' AND generations.share_slug IS NOT NULL
    AND EXISTS (SELECT 1 FROM generation_outputs
      WHERE generation_id = generations.id AND name = 'video')`;

/** A look's chip name: its first sentence, at most 40 characters, so a chip fits a phone. */
function lookLabel(text: string) {
  const sentence = (/^.*?[.!?](?=\s|$)/s.exec(text.trim())?.[0] ?? text).trim();

  return sentence.length > 40 ? `${sentence.slice(0, 39).trimEnd()}…` : sentence || "No look";
}

/**
 * The draft that recreates the take `id` with another character (`parseDraft`: validated, what
 * does not validate left out): `from` it, for its look and seed (a pre-rendered take's direction
 * is public, like its recipe), and its motion clip when that clip is a sample motion's, which
 * anyone may pick. Another clip is left out, so the wizard asks for a motion and keeps the rest.
 */
function remixOf(id: string, sampleClipId: string | null) {
  const draft = parseDraft({ from: id, motion: sampleClipId ?? undefined });

  return { draft, href: draftHref(draft), motionKept: draft.motion !== undefined };
}

/**
 * One example as a visitor without a session may see it, or `null` when it is not one any more
 * (its share page or result gone, a recipe Explore cannot read): only what is public is read.
 * The result and poster are outputs of a shared generation (`isSharedOutput`); the source clip is
 * shown only when it is a sample motion's (an upload that drove a take stays unshown here, even
 * though the take's share page shows it); the character only as `visibleCharacter` lets anyone
 * see it, and its image only when it is the very image the take was made from.
 */
function readExample(row: ExampleRow, origin: string): ExploreDetail | null {
  const share = readGenerationShare(row.share_slug, origin);
  const recipe = publishedRecipeSchema.safeParse(share?.recipe);
  const output = (name: string) => share?.outputs.find((each) => each.name === name)?.asset ?? null;
  const result = output("video");

  if (!share || !recipe.success || !result) {
    return null;
  }

  const { inputs, models, params, target, workflow } = recipe.data;
  const sample = row.motion_slug !== null && row.motion_title !== null && row.source_id !== null;
  const source = sample && row.source_id ? findAsset(row.source_id) : null;

  const character = visibleCharacter(
    row.character_id ? getCharacter(row.character_id) : null,
    false,
  );

  const characterTitle = character?.title ?? null;
  const motionTitle = sample ? (row.motion_title ?? "") : "Their own clip";

  return exploreDetailSchema.parse({
    character: character && {
      image: character.image.sha256 === inputs.reference_image_sha256 ? character.image : null,
      title: characterTitle,
    },
    characterTitle,
    compare: output("compare"),
    finishedAt: share.finishedAt,
    id: row.id,
    motion: { key: sample ? row.motion_slug : OWN_CLIP, sample, title: motionTitle },
    // The look as the recipe holds it, its chip name, and a key: 12 hex digits of its SHA-256.
    look: {
      key: createHash("sha256").update(params.prompt).digest("hex").slice(0, 12),
      label: lookLabel(params.prompt),
      text: params.prompt,
    },
    pageUrl: share.pageUrl,
    poster: output("poster"),
    recipe: {
      fragmentLength: params.fragment_length,
      height: params.height,
      models,
      target,
      width: params.width,
      workflow,
    },
    recipeUrl: `/api/generations/${row.id}/recipe.json`,
    remix: remixOf(row.id, source ? source.id : null),
    result,
    seed: params.seed,
    slug: row.share_slug,
    source: source && assetSchema.parse(source),
    title: characterTitle
      ? `${characterTitle} performs ${motionTitle}`
      : `A character performs ${motionTitle}`,
  });
}

/** By motion (sample motions by title, then own clips), then character, then newest first. */
function byMotionThenTitle(a: ExploreDetail, b: ExploreDetail) {
  return (
    Number(!a.motion.sample) - Number(!b.motion.sample) ||
    a.motion.title.localeCompare(b.motion.title) ||
    (a.characterTitle ?? "\uffff").localeCompare(b.characterTitle ?? "\uffff") ||
    (b.finishedAt ?? "").localeCompare(a.finishedAt ?? "")
  );
}

/**
 * The gallery `/explore`: every curated example (`examplesQuery`) as anyone may see it
 * (`readExample`), by motion, then character, then newest first. A read: it stores nothing and
 * starts nothing, so browsing never counts against an access code.
 */
export function listExamples(origin: string): ExploreEntry[] {
  return database
    .prepare(examplesQuery)
    .all()
    .flatMap((row) => readExample(exampleRowSchema.parse(row), origin) ?? [])
    .sort(byMotionThenTitle)
    .map((example) => exploreEntrySchema.parse(example));
}

/**
 * The page of the example whose share page is `/r/<slug>` (`readExample`); `null` for a slug no
 * curated example has: a take that was never curated, is no longer, or whose result is gone.
 */
export function readExampleBySlug(slug: string, origin: string): ExploreDetail | null {
  if (!/^[0-9a-f]{16}$/.test(slug)) {
    return null;
  }

  const row = database.prepare(`${examplesQuery} AND generations.share_slug = ?`).get(slug);

  return row ? readExample(exampleRowSchema.parse(row), origin) : null;
}
