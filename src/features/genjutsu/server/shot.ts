import { z } from "zod";

import { type Asset, assetSchema } from "../../../shared/contracts.ts";
import { findAsset, findBySha256 } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";
import {
  type characterSchema,
  type PickableCharacter,
  pickableCharacterSchema,
} from "../contracts.ts";
import { findCharacter } from "./characters.server.ts";
import { findGeneration, type Generation } from "./generations.ts";
import { isPublicAsset } from "./public-access.ts";

/** An asset as the API shows it (no server path), or `null` when none is stored with this id. */
function storedAsset(id: string) {
  const asset = findAsset(id);

  return asset ? assetSchema.parse(asset) : null;
}

/** An asset that must be stored, as the API shows it. */
export function publicAsset(id: string) {
  const asset = storedAsset(id);

  if (!asset) {
    throw new Error(`Asset ${id} is not stored`);
  }

  return asset;
}

/** A sample character with its reference image, as the picker lists it. */
export function pickable(character: z.output<typeof characterSchema>): PickableCharacter {
  return pickableCharacterSchema.parse({
    ...character,
    image: publicAsset(character.image_asset_id),
  });
}

/**
 * A character as a page may show it, with its image: `null` without a character, when its image
 * is not stored, or when the visitor has no session (`signedIn`) and the image is not public
 * (`isPublicAsset`: a sample's is; an uploaded photo never is). The one rule for every page.
 */
export function visibleCharacter(
  character: z.output<typeof characterSchema> | null,
  signedIn: boolean,
): PickableCharacter | null {
  const image = character ? storedAsset(character.image_asset_id) : null;

  if (!character || !image || !(signedIn || isPublicAsset(image.id))) {
    return null;
  }

  return pickableCharacterSchema.parse({ ...character, image });
}

/** The title of the sample motion whose clip this asset is; `null` for an upload or a cut. */
export function sampleMotionTitle(assetId: string) {
  const row = database.prepare("SELECT title FROM motions WHERE source_asset_id = ?").get(assetId);

  return row ? z.object({ title: z.string() }).parse(row).title : null;
}

/** The motion clip a generation was made from: the stored file its recipe's hash names. */
export function sourceClip(row: Generation): Asset {
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
      WHERE is_prerendered = 1 AND status = 'done' AND final_asset_id IS NOT NULL
      ORDER BY finished_at DESC LIMIT 1`,
    )
    .get();

  return row ? z.object({ id: z.string() }).parse(row).id : null;
}

/**
 * The take `findSampleTakeId` names, with what the studio home shows of it: its result and
 * poster, its source clip and the titles of its motion and character. `null` without one, or when
 * one of its files cannot be found (the home then shows the samples instead of failing).
 */
export function findSampleTake() {
  const id = findSampleTakeId();
  const generation = id ? findGeneration(id) : null;
  const result = generation?.final_asset_id ? storedAsset(generation.final_asset_id) : null;
  const source = generation ? findBySha256(generation.recipe.inputs.driving_video_sha256) : null;

  if (!generation || !result || !source) {
    return null;
  }

  const character = generation.character_id ? findCharacter(generation.character_id) : null;

  return {
    characterTitle: character?.title ?? null,
    id: generation.id,
    motionTitle: sampleMotionTitle(source.id),
    poster: generation.poster_asset_id ? storedAsset(generation.poster_asset_id) : null,
    result,
    source: assetSchema.parse(source),
  };
}
