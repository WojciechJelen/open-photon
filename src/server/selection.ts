import { z } from "zod";

import {
  type Asset,
  assetSchema,
  type characterSchema,
  MAX_CLIP_MS,
  type PickableCharacter,
  pickableCharacterSchema,
  type SampleMotion,
  sampleMotionSchema,
} from "../lib/contracts.ts";
import { findAsset } from "./assets.ts";
import { findCharacter, listSampleCharacters } from "./characters.server.ts";
import { database } from "./db.server.ts";

const motionRowSchema = z.object({
  attribution: z.string(),
  id: z.uuid(),
  license: z.string(),
  slug: z.string(),
  source_asset_id: z.uuid(),
  title: z.string(),
});

/** An asset as the API shows it: no server path. */
function publicAsset(id: string) {
  const asset = findAsset(id);

  if (!asset) {
    throw new Error(`Asset ${id} is not stored`);
  }

  return assetSchema.parse(asset);
}

/**
 * A video `generate` accepts as the motion: stored, probed and at most 8 s (uploads under 3 s
 * are never stored, and a cut is checked when it is made).
 */
function findMotionClip(id: string): Asset | null {
  const asset = findAsset(id);

  return asset?.kind === "video" &&
    asset.duration_ms !== null &&
    asset.width !== null &&
    asset.height !== null &&
    asset.duration_ms <= MAX_CLIP_MS
    ? assetSchema.parse(asset)
    : null;
}

function listSampleMotions(): SampleMotion[] {
  return database
    .prepare("SELECT * FROM motions ORDER BY title")
    .all()
    .map((row) => {
      const { source_asset_id, ...motion } = motionRowSchema.parse(row);

      return sampleMotionSchema.parse({ ...motion, clip: publicAsset(source_asset_id) });
    });
}

function pickable(character: z.output<typeof characterSchema>): PickableCharacter {
  return pickableCharacterSchema.parse({
    ...character,
    image: publicAsset(character.image_asset_id),
  });
}

/**
 * What the picker on `/` shows: the sample motions and characters, and the motion clip and
 * character the URL names. A character in the URL may be an upload (every upload has consent);
 * there are no accounts, so an uploaded character is listed only while the URL names it. An id
 * that names nothing usable (unknown, not a video, a clip over 8 s) resolves to `null`, so the
 * picker falls back to no choice.
 */
export function readSelection({ character, motion }: { character?: string; motion?: string }) {
  const chosen = character ? findCharacter(character) : null;

  return {
    character: chosen ? pickable(chosen) : null,
    characters: listSampleCharacters().map(pickable),
    motion: motion ? findMotionClip(motion) : null,
    motions: listSampleMotions(),
  };
}
