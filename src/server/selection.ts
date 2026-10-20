import { z } from "zod";

import {
  type AngleChoice,
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
import { anglePresets, generateDefaults } from "./presets.ts";
import { isPublicAsset } from "./public-access.ts";

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
 * What `/` shows: the sample motions and characters, the motion clip and character the URL
 * names, the reshoot-angle presets (`placeholderAngles` while their phrasing is not the
 * benchmarked one) and the description a blank one stands for (`defaultPrompt`). A character in
 * the URL may be an upload (every upload has consent); there are no accounts, so an uploaded
 * character is listed only while the URL names it. An id that names nothing usable (unknown, not
 * a video, a clip over 8 s) resolves to `null`, so the picker falls back to no choice. Without a
 * session (`signedIn` false), a usable choice whose file is not public (`isPublicAsset`: an
 * upload rather than a sample or a shared clip) keeps its id (`motionId`, `characterId`) but not
 * its details (`motion`, `character` are `null`): the picker asks for the code to show it, and
 * Generate can still send it and ask for the code then.
 */
export function readSelection(
  {
    character,
    motion,
  }: {
    character?: string;
    motion?: string;
  },
  signedIn: boolean,
) {
  const chosen = character ? findCharacter(character) : null;
  const clip = motion ? findMotionClip(motion) : null;

  return {
    angles: anglePresets.angles.map(({ id, label }): AngleChoice => ({ id, label })),
    character:
      chosen && (signedIn || isPublicAsset(chosen.image_asset_id)) ? pickable(chosen) : null,
    characterId: chosen?.id ?? null,
    characters: listSampleCharacters().map(pickable),
    defaultPrompt: generateDefaults.prompt,
    motion: clip && (signedIn || isPublicAsset(clip.id)) ? clip : null,
    motionId: clip?.id ?? null,
    motions: listSampleMotions(),
    placeholderAngles: anglePresets.placeholder,
    signedIn,
  };
}
