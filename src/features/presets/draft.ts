// A preset as Motion Transfer's draft: the preset page's search, the direction it starts with, the
// draft "Open in Motion Transfer" links to, and what Generate sends. Client-safe and loadable by
// Node (relative `.ts` imports), so `npm run test:server` exercises it.
import { z } from "zod";

import {
  type Direction,
  type MotionTransferDraft,
  motionTransferDraftSchema,
  parseDraft,
} from "../motionTransfer/api.ts";
import type { Preset } from "./catalog.ts";
import type { PresetGenerateInput } from "./contracts.ts";

/**
 * The search of a preset's page (`/presets/:presetId`), so a reload, Back and Forward keep the
 * visitor's choices: the preset `version` the link was made for, and the members of Motion
 * Transfer's draft the visitor sets (`character`, and `prompt`/`seed` only where they differ from
 * the preset's, with the draft's own resets: `""` the photo's look, `"default"` the fixed seed).
 * Decoded like a draft: a member that does not validate comes out `undefined`.
 */
export const presetSearchSchema = motionTransferDraftSchema
  .pick({ character: true, prompt: true, seed: true })
  .extend({ version: z.int().positive().optional().catch(undefined) });

export type PresetSearch = z.output<typeof presetSearchSchema>;

type DirectionMembers = Pick<PresetSearch, "prompt" | "seed">;

/** The direction the page's form shows: each member the search sets, over the preset's. */
export function presetDirection(preset: Preset, { prompt, seed }: DirectionMembers): Direction {
  return {
    prompt: prompt ?? preset.defaults.prompt,
    seed:
      seed === undefined ? String(preset.defaults.seed) : seed === "default" ? "" : String(seed),
  };
}

/** The seed the form's text stands for: `"default"` when blank, NaN when not a whole number. */
function formSeed(text: string) {
  const trimmed = text.trim();

  return trimmed === "" ? "default" : /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/**
 * The direction members that differ from the preset's, as the form holds them: a blank look is
 * `""`, a blank seed `"default"`; a member equal to the preset's is left out. Not validated:
 * a seed that is not a number is NaN, which `presetGenerateInputSchema` refuses.
 */
function changedMembers(preset: Preset, direction: Direction) {
  const prompt = direction.prompt.trim() === "" ? "" : direction.prompt;
  const seed = formSeed(direction.seed);

  return {
    prompt: prompt === preset.defaults.prompt ? undefined : prompt,
    seed: seed === preset.defaults.seed ? undefined : seed,
  };
}

/**
 * The search members for the form's direction (`changedMembers`), validated as a draft's: what
 * Motion Transfer would refuse (a look over 500 characters, a seed that is not a number yet) is
 * left out, so a reload falls back to the preset's for it.
 */
export function directionSearch(preset: Preset, direction: Direction): DirectionMembers {
  const { prompt, seed } = parseDraft(changedMembers(preset, direction));

  return { prompt, seed };
}

/**
 * The form's direction once the page's preset or search changed under it (a catalog refresh, a
 * version accepted, Back or Forward): `current` while it says what the search says, so an edit
 * the search already holds stays as typed; otherwise the search's members over the preset's
 * (`presetDirection`), so no value of another version or another history entry is sent as a
 * change.
 */
export function reconciledDirection(
  preset: Preset,
  search: DirectionMembers,
  current: Direction,
): Direction {
  const wanted = presetDirection(preset, search);
  const held = directionSearch(preset, current);
  const meant = directionSearch(preset, wanted);

  return held.prompt === meant.prompt && held.seed === meant.seed ? current : wanted;
}

/** A background a look names: the rest of its `Background: …` sentence. */
const namedBackground = /(?:^|\s)Background: ([^]+?)(?:[.!?](?=\s|$)|$)/;

/**
 * What a look comes to in a few words, for the page's look row (a preset names no look of its own):
 * the background `prompt` names, the photo's when it keeps that one or says nothing (a blank look is
 * Motion Transfer's default, the photo's), else the visitor's words as they are. `own` says the look
 * is no longer the preset's; `caption` says where it comes from.
 */
export function lookSummary(preset: Preset, prompt: string) {
  const look = prompt.trim();
  const background = namedBackground.exec(look)?.[1];
  const own = prompt !== preset.defaults.prompt;

  if (background) {
    return {
      caption: own ? "Your look" : "Background from this preset",
      own,
      title: `${background.charAt(0).toUpperCase()}${background.slice(1)}`,
    };
  }

  return {
    caption: own ? "Your look" : "Look from this preset",
    own,
    title: look === "" || /(?:^|\s)Background as in /.test(look) ? "As in your photo" : look,
  };
}

/**
 * What Generate sends, before `presetGenerateInputSchema` checks it: the version, the character
 * (none yet is `undefined`, which the schema refuses) and the changes (`changedMembers`).
 */
export function presetRequest(preset: Preset, character: string | undefined, direction: Direction) {
  return { character_id: character, ...changedMembers(preset, direction), version: preset.version };
}

/**
 * The concrete look and seed a request renders with: each the visitor's change, else the
 * preset's. A reset (`""`, `"default"`) is left out, so Motion Transfer fills in its own
 * default, which its recipe stores as a concrete value like any other.
 */
export function resolveDirection(
  preset: Preset,
  { prompt, seed }: Pick<PresetGenerateInput, "prompt" | "seed">,
) {
  return {
    prompt: prompt === undefined ? preset.defaults.prompt : prompt === "" ? undefined : prompt,
    seed: seed === undefined ? preset.defaults.seed : seed === "default" ? undefined : seed,
  };
}

/**
 * The preset as Motion Transfer's draft (validated by `parseDraft`): its motion (the stored clip,
 * `motion`), the character picked, and the look and seed resolved (`resolveDirection`, resets kept
 * as the draft's). The wizard opens it on Direct with a character, else on the Character step,
 * which asks for one; everything stays editable there.
 */
export function presetDraft(
  preset: Preset,
  motion: string,
  { character, prompt, seed }: Pick<PresetSearch, "character" | "prompt" | "seed">,
): MotionTransferDraft {
  return parseDraft({
    character,
    motion,
    prompt: prompt ?? preset.defaults.prompt,
    seed: seed ?? preset.defaults.seed,
    step: character ? "direct" : "character",
  });
}
