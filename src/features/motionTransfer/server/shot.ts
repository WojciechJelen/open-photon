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
 * The id of the newest done pre-rendered sample generation (`is_prerendered`) of a seeded sample
 * character and a sample motion's stored clip, or `null`: one query, for the wizard's access
 * dialog, which offers that take as the free way in. Its page is public, like its result, poster
 * and clip. A take of any other character or clip is never offered.
 */
export function findSampleTakeId() {
  const row = database
    .prepare(
      `SELECT generations.id FROM generations
      JOIN characters
        ON characters.id = generations.character_id AND characters.is_sample = 1
      JOIN assets ON assets.sha256 = generations.recipe ->> '$.inputs.driving_video_sha256'
      JOIN motions ON motions.source_asset_id = assets.id
      WHERE generations.is_prerendered = 1 AND generations.status = 'done'
        AND generations.workflow_id = 'motion-transfer'
        AND EXISTS (SELECT 1 FROM generation_outputs
          WHERE generation_id = generations.id AND name = 'video')
      ORDER BY generations.finished_at DESC LIMIT 1`,
    )
    .get();

  return row ? z.object({ id: z.string() }).parse(row).id : null;
}

/** An `assets` row as one JSON object (`assetSchema`'s fields), or SQL `NULL` without a row. */
function assetJson(alias: string) {
  return `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE json_object(
    'bytes', ${alias}.bytes, 'created_at', ${alias}.created_at,
    'duration_ms', ${alias}.duration_ms, 'fps', ${alias}.fps,
    'has_audio', CASE ${alias}.has_audio WHEN 1 THEN json('true') WHEN 0 THEN json('false') END,
    'height', ${alias}.height, 'id', ${alias}.id, 'kind', ${alias}.kind, 'mime', ${alias}.mime,
    'role', ${alias}.role, 'sha256', ${alias}.sha256, 'source_asset_id', ${alias}.source_asset_id,
    'width', ${alias}.width) END`;
}

/** A column `assetJson` made, as the API shows the asset. */
const assetColumn = z.string().transform((value) => assetSchema.parse(JSON.parse(value)));

const wallRowSchema = z.object({
  character_title: z.string(),
  id: z.string(),
  motion_title: z.string(),
  poster: assetColumn.nullable(),
  share_slug: z.string(),
  source: assetColumn,
  video: assetColumn,
});

/** How many takes the studio home's result wall shows at most (`listPrerenderedTakes`). */
const WALL_TAKES = 8;

/**
 * The done pre-rendered sample takes (`is_prerendered`) of a seeded sample character
 * (`is_sample = 1`) and a sample motion's clip, with their result and a share page, in one
 * query: what the studio home's result wall shows, at most `WALL_TAKES`, by motion title, then
 * character title, then newest first. A take of any other character or clip is never listed.
 * Each one's share page (`/r/:slug`), result and poster are public (`isSharedOutput`), and so is
 * its `source` clip (a sample motion's).
 */
export function listPrerenderedTakes() {
  return database
    .prepare(
      `SELECT generations.id, generations.share_slug, characters.title AS character_title,
        motions.title AS motion_title, ${assetJson("source")} AS source,
        ${assetJson("video_asset")} AS video, ${assetJson("poster_asset")} AS poster
      FROM generations
      JOIN characters
        ON characters.id = generations.character_id AND characters.is_sample = 1
      JOIN assets AS source
        ON source.sha256 = generations.recipe ->> '$.inputs.driving_video_sha256'
      JOIN motions ON motions.source_asset_id = source.id
      JOIN generation_outputs AS video
        ON video.generation_id = generations.id AND video.name = 'video'
      JOIN assets AS video_asset ON video_asset.id = video.asset_id
      LEFT JOIN generation_outputs AS poster
        ON poster.generation_id = generations.id AND poster.name = 'poster'
      LEFT JOIN assets AS poster_asset ON poster_asset.id = poster.asset_id
      WHERE generations.is_prerendered = 1 AND generations.status = 'done'
        AND generations.workflow_id = 'motion-transfer' AND generations.share_slug IS NOT NULL
      ORDER BY motions.title, characters.title, generations.finished_at DESC, generations.id
      LIMIT ?`,
    )
    .all(WALL_TAKES)
    .map((row) => {
      const take = wallRowSchema.parse(row);

      return {
        characterTitle: take.character_title,
        id: take.id,
        motionTitle: take.motion_title,
        poster: take.poster,
        result: take.video,
        shareSlug: take.share_slug,
        source: take.source,
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
