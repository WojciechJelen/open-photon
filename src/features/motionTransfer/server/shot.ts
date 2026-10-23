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
 * character's current image and a sample motion's stored clip, or `null`: one query, for the
 * wizard's access dialog, which offers that take as the free way in. Its page is public, like its
 * result, poster and clip. A take of any other character or clip, or of an image the sample no
 * longer has (re-rendered since), is never offered.
 */
export function findSampleTakeId() {
  const row = database
    .prepare(
      `SELECT generations.id FROM generations
      JOIN characters
        ON characters.id = generations.character_id AND characters.is_sample = 1
      JOIN assets AS reference ON reference.id = characters.image_asset_id
        AND reference.sha256 = generations.recipe ->> '$.inputs.reference_image_sha256'
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

/** The `assets` columns the API shows (`assetSchema`'s fields). */
const ASSET_FIELDS = assetSchema.keyof().options;

/** An `assets` row's API columns, each selected as `<alias>_<field>`. */
function assetColumns(alias: string) {
  return ASSET_FIELDS.map((field) => `${alias}.${field} AS ${alias}_${field}`).join(", ");
}

const wallRowSchema = z.looseObject({
  character_title: z.string(),
  id: z.string(),
  motion_title: z.string(),
  poster_asset_id: z.string().nullable(),
  share_slug: z.string(),
});

/** The asset `assetColumns(alias)` selected in a wall row, as the API shows it. */
function assetFrom(row: z.output<typeof wallRowSchema>, alias: string) {
  const fields = Object.fromEntries(ASSET_FIELDS.map((field) => [field, row[`${alias}_${field}`]]));
  const hasAudio = fields.has_audio;

  return assetSchema.parse({ ...fields, has_audio: hasAudio === null ? null : hasAudio === 1 });
}

/** How many tiles the studio home's result wall shows at most: takes plus a source clip per motion. */
const WALL_TILES = 8;

/**
 * The done pre-rendered sample takes (`is_prerendered`) of a seeded sample character's current
 * image (`is_sample = 1`) and a sample motion's clip, with their result and a share page, in one
 * query: what the studio home's result wall shows, by motion title, then character title, then
 * newest first. Each motion's group is its source tile and the same number of takes, at most as
 * many as keep the wall within `WALL_TILES` tiles (with more motions than fit, the first ones). A
 * take of any other character, image or clip is never listed. Each one's share page (`/r/:slug`),
 * result and poster are public (`isSharedOutput`), and so is its `source` clip (a sample motion's).
 */
export function listPrerenderedTakes() {
  return database
    .prepare(
      `WITH takes AS (
        SELECT generations.id, generations.share_slug, characters.title AS character_title,
          motions.title AS motion_title, ${assetColumns("source")},
          ${assetColumns("video_asset")}, ${assetColumns("poster_asset")},
          row_number() OVER (PARTITION BY motions.id
            ORDER BY characters.title, generations.finished_at DESC, generations.id) AS take_rank,
          dense_rank() OVER (ORDER BY motions.title, motions.id) AS motion_rank
        FROM generations
        JOIN characters
          ON characters.id = generations.character_id AND characters.is_sample = 1
        JOIN assets AS reference ON reference.id = characters.image_asset_id
          AND reference.sha256 = generations.recipe ->> '$.inputs.reference_image_sha256'
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
      ),
      -- Takes per motion: an equal share of the tiles, less the motion's source tile; at least one.
      shape AS (SELECT max(1, ${WALL_TILES} / max(motion_rank) - 1) AS per_motion FROM takes)
      SELECT takes.* FROM takes, shape
      WHERE take_rank <= per_motion AND motion_rank * (per_motion + 1) <= ${WALL_TILES}
      ORDER BY motion_rank, take_rank`,
    )
    .all()
    .map((row) => {
      const take = wallRowSchema.parse(row);

      return {
        characterTitle: take.character_title,
        id: take.id,
        motionTitle: take.motion_title,
        poster: take.poster_asset_id === null ? null : assetFrom(take, "poster_asset"),
        result: assetFrom(take, "video_asset"),
        shareSlug: take.share_slug,
        source: assetFrom(take, "source"),
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
