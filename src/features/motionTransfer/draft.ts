// Motion Transfer's draft: what a take is made of before it is generated, as the wizard at
// `/motionTransfer` holds it in its URL. Client-safe, and loadable by Node as is (relative `.ts`
// imports), so `npm run test:server` exercises it; other features take it from `api.ts`.
import { defaultStringifySearch } from "@tanstack/react-router";
import { z } from "zod";

import { generateInputSchema } from "./contracts.ts";

/** The wizard's steps at `/motionTransfer`; the fourth, Render, is the generation's page `/g/:id`. */
const wizardSteps = ["motion", "character", "direct"] as const;

export type WizardStep = (typeof wizardSteps)[number];

const { angle, prompt, seed } = generateInputSchema.shape;

const seedSchema = seed.unwrap();

/**
 * Motion Transfer's draft, the published prefill and remix contract, held in the URL of
 * `/motionTransfer` so a reload, Back and Forward and a shared link land on the same screen:
 *
 * - `step` and the picks: `motion` (the id of a stored 3–8 s video asset: a sample motion's clip,
 *   an upload or a cut of one) and `character` (a character's id);
 * - `from`, the generation whose direction (angle, look, seed) the Direct step starts with
 *   ("Change the shot", the remixes);
 * - the direction fields, which prefill the Direct step over `from`'s, each on its own: `angle`
 *   (a reshoot preset's id of `workflows/angles.json`, or `none` for As filmed; an id the wizard
 *   does not offer is ignored), `prompt` (the look: appearance and background, 1–500 characters
 *   once trimmed) and `seed` (a whole number from 0 to `Number.MAX_SAFE_INTEGER`).
 *
 * A link is untrusted: a member that does not validate comes out `undefined`, so a mangled link
 * falls back to no choice (as the route's search, the `undefined` overrides the raw value the
 * router keeps). Outside the route, decode with `parseDraft`, which leaves such members out.
 */
export const motionTransferDraftSchema = z.object({
  step: z.enum(wizardSteps).optional().catch(undefined),
  motion: z.uuid().optional().catch(undefined),
  character: z.uuid().optional().catch(undefined),
  from: z.uuid().optional().catch(undefined),
  angle: angle.catch(undefined),
  prompt: prompt.catch(undefined),
  seed: seed.catch(undefined),
});

export type MotionTransferDraft = z.output<typeof motionTransferDraftSchema>;

const draftKeys = motionTransferDraftSchema.keyof().options;

/** The draft without the members that came out `undefined` (given, but not valid). */
function definedMembers(draft: MotionTransferDraft): MotionTransferDraft {
  const defined = { ...draft };

  for (const key of draftKeys) {
    if (defined[key] === undefined) {
      delete defined[key];
    }
  }

  return defined;
}

const draftDecoder = motionTransferDraftSchema.catch({}).transform(definedMembers);

/**
 * Decodes untrusted input (URL search, stored or posted JSON) into a draft: never throws, keeps
 * the members that validate (`motionTransferDraftSchema`) and leaves out the rest, unknown ones
 * too.
 */
export const parseDraft = draftDecoder.parse.bind(draftDecoder);

/**
 * The URL that opens the wizard on `draft`, for an `<a href>` or `navigate({ href })`; a
 * `<Link to="/motionTransfer" search={draft}>` is the same. Presets and Explore prefill the wizard
 * with it, without touching the wizard.
 *
 * "Animate this character" (DEV-294) is `draftHref({ character: id, motion })`: the character's
 * id (a row of the picker's `pickableCharacterSchema`), and the motion when the visitor came with
 * one picked. With a motion, the wizard opens on Direct; without one, on motion selection, with
 * the character kept (`shownStep`).
 */
export function draftHref(draft: MotionTransferDraft) {
  return `/motionTransfer${defaultStringifySearch(parseDraft(draft))}`;
}

/**
 * The step to show for `step` and the picks the URL holds: a step is reachable once every step
 * before it has its pick (Character needs a motion, Direct needs both), so a link to a step
 * whose prerequisites are missing shows the furthest one it can reach. Without a step, the first
 * one still to pick, or Direct when both are picked: a remix link names only what it keeps.
 */
export function shownStep(
  step: WizardStep | undefined,
  { character, motion }: { character: string | null; motion: string | null },
): WizardStep {
  const reachable: WizardStep = !motion ? "motion" : !character ? "character" : "direct";

  if (!step) {
    return reachable;
  }

  return wizardSteps.indexOf(step) <= wizardSteps.indexOf(reachable) ? step : reachable;
}

/**
 * The Direct step's choices, as its form holds them while they are edited: `angle` `none` is As
 * filmed, a blank `prompt` the workflow's own description, a blank `seed` the fixed default. The
 * seed is the text typed, which may not be a number yet.
 */
export type Direction = { angle: string; prompt: string; seed: string };

/** As filmed, the photo's look, the fixed seed. */
export const defaultDirection: Direction = { angle: "none", prompt: "", seed: "" };

/** The seed the form's text stands for: none when blank; anything but digits is NaN, which no schema takes. */
export function formSeed(text: string) {
  const trimmed = text.trim();

  return trimmed === "" ? undefined : /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** The draft's direction fields for what the form holds (`snapshotDraft` drops what is not valid). */
export function directionFields(direction: Direction): MotionTransferDraft {
  return { angle: direction.angle, prompt: direction.prompt, seed: formSeed(direction.seed) };
}

/**
 * The direction the Direct step starts with: each direction field the draft sets, over `start`
 * (the direction of the take the draft comes `from`, else `defaultDirection`). An angle that is
 * neither `none` nor one of `angles` (the presets the wizard offers) keeps `start`'s.
 */
export function startingDirection(
  draft: MotionTransferDraft,
  start: Direction,
  angles: readonly string[],
): Direction {
  const offered = draft.angle === "none" || angles.includes(draft.angle ?? "");

  return {
    angle: offered && draft.angle ? draft.angle : start.angle,
    prompt: draft.prompt ?? start.prompt,
    seed: draft.seed === undefined ? start.seed : String(draft.seed),
  };
}

/**
 * A draft as a generation action gets it: picks and direction, without the step, validated (what
 * does not validate is left out, as `parseDraft` does), copied and frozen. Every member is a
 * string or a number, so the frozen copy is frozen all the way down and shares nothing with
 * `draft`. Derive another with `withSeed` and `withCharacter`.
 */
export type DraftSnapshot = Readonly<Omit<MotionTransferDraft, "step">>;

export function snapshotDraft(draft: MotionTransferDraft): DraftSnapshot {
  const snapshot = parseDraft(draft);

  delete snapshot.step;

  return Object.freeze(snapshot);
}

/** `snapshot` with another seed; throws for one that is not a whole number from 0 to `Number.MAX_SAFE_INTEGER`. */
export function withSeed(snapshot: DraftSnapshot, nextSeed: number) {
  return snapshotDraft({ ...snapshot, seed: seedSchema.parse(nextSeed) });
}

/** `snapshot` with another character; throws for an id that is not a UUID. */
export function withCharacter(snapshot: DraftSnapshot, characterId: string) {
  return snapshotDraft({ ...snapshot, character: z.uuid().parse(characterId) });
}
