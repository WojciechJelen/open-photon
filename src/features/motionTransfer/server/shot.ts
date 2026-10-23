import { z } from "zod";

import { type Asset, assetSchema } from "../../../shared/contracts.ts";
import { findAsset, findBySha256 } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";
import { readOutputs } from "../../../shared/server/generation/generations.ts";
import { getCharacter } from "../../characters/api.ts";
import { findGeneration, type MotionTransferGeneration } from "./generations.ts";

/** An asset that must be stored, as the API shows it. */
export function publicAsset(id: string) {
  const asset = findAsset(id);

  if (!asset) {
    throw new Error(`Asset ${id} is not stored`);
  }

  return assetSchema.parse(asset);
}

/** The title of the sample motion whose clip this asset is; `null` for an upload or a cut. */
export function sampleMotionTitle(assetId: string) {
  const row = database.prepare("SELECT title FROM motions WHERE source_asset_id = ?").get(assetId);

  return row ? z.object({ title: z.string() }).parse(row).title : null;
}

/** The motion clip a generation was made from: the stored file its recipe's hash names. */
export function sourceClip(row: MotionTransferGeneration): Asset {
  const source = findBySha256(row.recipe.inputs.driving_video_sha256);

  if (!source) {
    throw new Error(`Generation ${row.id} has no stored motion clip`);
  }

  return assetSchema.parse(source);
}

/**
 * The id of the newest done pre-rendered sample generation (`is_prerendered`, the sample × sample
 * matrix) whose motion clip is stored, or `null`: one query, for the wizard's access dialog,
 * which offers that take as the free way in. Its page is public, like its result, poster and clip.
 */
export function findSampleTakeId() {
  const row = database
    .prepare(
      `SELECT generations.id FROM generations
      JOIN assets ON assets.sha256 = generations.recipe ->> '$.inputs.driving_video_sha256'
      WHERE is_prerendered = 1 AND status = 'done' AND workflow_id = 'motion-transfer'
        AND EXISTS (SELECT 1 FROM generation_outputs
          WHERE generation_id = generations.id AND name = 'video')
      ORDER BY finished_at DESC LIMIT 1`,
    )
    .get();

  return row ? z.object({ id: z.string() }).parse(row).id : null;
}

const wallRowSchema = z.object({
  character_id: z.string().nullable(),
  id: z.string(),
  poster_id: z.string().nullable(),
  share_slug: z.string(),
  source_id: z.string(),
  video_id: z.string(),
});

/**
 * Every done pre-rendered sample take (`is_prerendered`, the sample × sample matrix) with its
 * result, a share page and a stored motion clip, newest first, in one query: what the studio
 * home's result wall shows. Each one's share page (`/r/:slug`), result and poster are public
 * (`isSharedOutput`), and so is its `source` clip (a sample motion's). The titles are its
 * character's and its sample motion's; `null` for one no longer seeded.
 */
export function listPrerenderedTakes() {
  return database
    .prepare(
      `SELECT generations.id, generations.share_slug, generations.character_id,
        source.id AS source_id, video.asset_id AS video_id, poster.asset_id AS poster_id
      FROM generations
      JOIN assets AS source
        ON source.sha256 = generations.recipe ->> '$.inputs.driving_video_sha256'
      JOIN generation_outputs AS video
        ON video.generation_id = generations.id AND video.name = 'video'
      LEFT JOIN generation_outputs AS poster
        ON poster.generation_id = generations.id AND poster.name = 'poster'
      WHERE is_prerendered = 1 AND status = 'done' AND workflow_id = 'motion-transfer'
        AND share_slug IS NOT NULL
      ORDER BY finished_at DESC, generations.id`,
    )
    .all()
    .map((row) => {
      const take = wallRowSchema.parse(row);

      return {
        characterTitle: take.character_id ? (getCharacter(take.character_id)?.title ?? null) : null,
        id: take.id,
        motionTitle: sampleMotionTitle(take.source_id),
        poster: take.poster_id ? publicAsset(take.poster_id) : null,
        result: publicAsset(take.video_id),
        shareSlug: take.share_slug,
        source: publicAsset(take.source_id),
      };
    });
}

/**
 * The take `findSampleTakeId` names, with what the studio home shows of it: its result and
 * poster, its source clip and the titles of its motion and character. `null` without one, or when
 * one of its files cannot be found (the home then shows the samples instead of failing).
 */
export function findSampleTake() {
  const id = findSampleTakeId();
  const generation = id ? findGeneration(id) : null;
  const outputs = generation ? readOutputs(generation.id) : [];
  const result = outputs.find(({ name }) => name === "video")?.asset;
  const source = generation ? findBySha256(generation.recipe.inputs.driving_video_sha256) : null;

  if (!generation || !result || !source) {
    return null;
  }

  const character = generation.character_id ? getCharacter(generation.character_id) : null;

  return {
    characterTitle: character?.title ?? null,
    id: generation.id,
    motionTitle: sampleMotionTitle(source.id),
    poster: outputs.find(({ name }) => name === "poster")?.asset ?? null,
    result,
    source: assetSchema.parse(source),
  };
}
