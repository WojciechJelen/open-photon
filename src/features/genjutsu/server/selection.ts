import { z } from "zod";

import { type Asset, assetSchema } from "../../../shared/contracts.ts";
import { findAsset } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";
import {
  type AngleChoice,
  MAX_CLIP_MS,
  type SampleMotion,
  sampleMotionSchema,
} from "../contracts.ts";
import { findCharacter, listSampleCharacters } from "./characters.server.ts";
import { findGeneration } from "./generations.ts";
import { anglePresets, generateDefaults } from "./presets.ts";
import { isPublicAsset } from "./public-access.ts";
import {
  findSampleTake,
  findSampleTakeId,
  pickable,
  publicAsset,
  visibleCharacter,
} from "./shot.ts";

const motionRowSchema = z.object({
  attribution: z.string(),
  id: z.uuid(),
  license: z.string(),
  slug: z.string(),
  source_asset_id: z.uuid(),
  title: z.string(),
});

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

/**
 * The direction a generation was made with, as the wizard's Direct step holds it, so "Change the
 * shot" and the remixes open it ready to tweak: the angle's preset id (`none`: As filmed), the
 * look as it was sent (its angle phrasing taken off the end again; the default description is a
 * blank look) and the seed (the fixed default is a blank one). `null` for an unknown id, or for a
 * generation the visitor may not read: without a session (`signedIn`), only a pre-rendered
 * sample's.
 */
function readDirection(id: string, signedIn: boolean) {
  const row = findGeneration(id);

  if (!row || !(signedIn || row.is_prerendered)) {
    return null;
  }

  const { angle: angleId, params } = row.recipe;
  const angle = anglePresets.angles.find((preset) => preset.id === angleId);
  const phrasing = angle ? ` ${angle.fragment}` : "";

  const look =
    phrasing && params.prompt.endsWith(phrasing)
      ? params.prompt.slice(0, -phrasing.length)
      : params.prompt;

  return {
    angle: angle?.id ?? "none",
    prompt: look === generateDefaults.prompt ? "" : look,
    seed: params.seed === generateDefaults.seed ? "" : String(params.seed),
  };
}

/**
 * What the Genjutsu wizard (`/genjutsu`) shows: the sample motions and
 * characters, the motion clip and character the URL names, the reshoot-angle presets
 * (`placeholderAngles` while their phrasing is not the benchmarked one), the description a blank
 * one stands for (`defaultPrompt`), the direction of the take the URL comes `from`
 * (`readDirection`), and the id of the pre-rendered sample take anyone may open for free
 * (`sampleTakeId`). A character in
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
    from,
    motion,
  }: {
    character?: string;
    from?: string;
    motion?: string;
  },
  signedIn: boolean,
) {
  const chosen = character ? findCharacter(character) : null;
  const clip = motion ? findMotionClip(motion) : null;

  return {
    angles: anglePresets.angles.map(({ id, label }): AngleChoice => ({ id, label })),
    character: visibleCharacter(chosen, signedIn),
    characterId: chosen?.id ?? null,
    characters: listSampleCharacters().map(pickable),
    defaultPrompt: generateDefaults.prompt,
    direction: from ? readDirection(from, signedIn) : null,
    motion: clip && (signedIn || isPublicAsset(clip.id)) ? clip : null,
    motionId: clip?.id ?? null,
    motions: listSampleMotions(),
    placeholderAngles: anglePresets.placeholder,
    sampleTakeId: findSampleTakeId(),
    signedIn,
  };
}

/**
 * What the studio home `/` shows: the sample motions and characters, and the pre-rendered sample
 * take (`findSampleTake`) when there is one. Public, like the samples and the take.
 */
export function readStudio() {
  return {
    characters: listSampleCharacters().map(pickable),
    motions: listSampleMotions(),
    sampleTake: findSampleTake(),
  };
}
