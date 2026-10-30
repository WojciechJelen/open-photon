import { z } from "zod";

import { type Asset, assetSchema } from "../../../shared/contracts.ts";
import { findAsset } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";
import {
  getCharacter,
  listCharacters,
  listSampleCharacters,
  visibleCharacter,
} from "../../characters/api.ts";
import { MAX_CLIP_MS, type SampleMotion, sampleMotionSchema } from "../contracts.ts";
import type { Direction } from "../draft.ts";
import { findGeneration } from "./generations.ts";
import { generateDefaults } from "./presets.ts";
import { isPublicAsset } from "./public-access.ts";
import type { Recipe } from "./recipe.ts";
import { findSampleTake, findSampleTakeId, listPrerenderedTakes, publicAsset } from "./shot.ts";

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
 * Every phrasing a reshoot-angle preset appended to the look (`prepareRecipe`, after a space)
 * before the angle benchmark (`docs/angle-benchmark-2026-10-23/`) removed the presets: the three
 * of `angles.json`, and an earlier profile phrasing that a development take carries
 * (`fixtures/historical-recipes.json`). Frozen: no new recipe has an `angle`.
 */
const retiredAngleFragments = [
  "Front view: the camera faces the character straight on.",
  "Three-quarter view: the camera is turned 45 degrees to the character's side.",
  "Profile view: the camera sees the character from the side.",
  "Profile view: the camera sees the subject from the side.",
];

/**
 * The direction `recipe` was made with, as the wizard's Direct step holds it, so "Change the
 * shot", the remixes and a take's generation actions start from it: the look as it was sent (the
 * default description is a blank look) and the seed (the fixed default is a blank one). A take
 * made with one of the retired reshoot-angle presets has its phrasing taken off the end again, so
 * its look is the one typed (at most 500 characters), blank if it was blank.
 */
export function directionOf({ angle, params }: Recipe): Direction {
  const phrasing =
    angle === undefined
      ? undefined
      : retiredAngleFragments.find((fragment) => params.prompt.endsWith(` ${fragment}`));

  const look = phrasing ? params.prompt.slice(0, -(phrasing.length + 1)) : params.prompt;

  return {
    prompt: look === generateDefaults.prompt ? "" : look,
    seed: params.seed === generateDefaults.seed ? "" : String(params.seed),
  };
}

/**
 * The direction of the generation `id` (`directionOf`); `null` for an unknown id, or for a
 * generation the visitor may not read: without a session (`signedIn`), only a pre-rendered
 * sample's.
 */
function readDirection(id: string, signedIn: boolean) {
  const row = findGeneration(id);

  return row && (signedIn || row.is_prerendered) ? directionOf(row.recipe) : null;
}

/**
 * What a page that picks a motion and a character shows (`/motionTransfer`, a preset's page and
 * the other tools): the sample motions, the characters to pick from, the motion clip and character
 * the URL names, the description a blank one stands for (`defaultPrompt`), the direction of the
 * take the URL comes `from` (`readDirection`), and the id of the pre-rendered sample take anyone may
 * open for free (`sampleTakeId`). `characters` is, with a session, the workspace library with the
 * samples, exactly what `GET /api/characters` answers, so the picker's first paint is its settled
 * one; without a session, only the samples: an upload needs the code. `samples` is the samples
 * alone, by title, for what must not list the library. A character in the URL may be an upload
 * (every upload has consent). An id that names nothing usable (unknown, not a video, a clip over
 * 8 s) resolves to `null`, so the picker falls back to no choice. Without a session (`signedIn`
 * false), a usable choice whose file is not public (`isPublicAsset`: an upload rather than a sample
 * or a shared clip) keeps its id (`motionId`, `characterId`) but not its details (`motion`,
 * `character` are `null`): the picker asks for the code to show it, and Generate can still send it
 * and ask for the code then.
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
  const chosen = character ? getCharacter(character) : null;
  const clip = motion ? findMotionClip(motion) : null;
  const samples = listSampleCharacters();

  return {
    character: visibleCharacter(chosen, signedIn),
    characterId: chosen?.id ?? null,
    characters: signedIn ? listCharacters({ includeSamples: true }) : samples,
    defaultPrompt: generateDefaults.prompt,
    direction: from ? readDirection(from, signedIn) : null,
    motion: clip && (signedIn || isPublicAsset(clip.id)) ? clip : null,
    motionId: clip?.id ?? null,
    motions: listSampleMotions(),
    sampleTakeId: findSampleTakeId(),
    samples,
    signedIn,
  };
}

/**
 * What the studio home `/` shows: the sample motions and characters, the pre-rendered sample
 * take (`findSampleTake`) when there is one, and the pre-rendered sample takes the result wall
 * shows, eight tiles at most with their source clips (`listPrerenderedTakes`). Public, like the
 * samples and the takes.
 */
export function readStudio() {
  return {
    characters: listSampleCharacters(),
    motions: listSampleMotions(),
    sampleTake: findSampleTake(),
    wall: listPrerenderedTakes(),
  };
}
