// The builder's form as the requests take it: the controls without blanks, the seed as a number,
// the requests in one normalized shape, so the same request always makes the same request key.
import type { BuilderForm } from "#/features/characterBuilder/builder-memory";
import {
  characterCaptionInputSchema,
  type CharacterControls,
  type CharacterGenerationInput,
  characterGenerationInputSchema,
  type CharacterStyle,
} from "#/features/characterBuilder/contracts";

/** Each style as the form names it. */
export const styleLabels: Record<CharacterStyle, string> = {
  anime: "Anime",
  illustration: "Illustration",
  realistic: "Realistic",
  "stylized-3d": "Stylized 3D",
};

/** The slug of the sample character that shows each style on its tile. */
export const styleSamples: Record<CharacterStyle, string> = {
  anime: "yuki",
  illustration: "arthur",
  realistic: "maya",
  "stylized-3d": "theo",
};

/** The controls the form sets: a blank field is no control, a filled one is sent as typed. */
export function controlsOf(form: BuilderForm): CharacterControls {
  const controls: CharacterControls = {};

  if (form.appearance.trim() !== "") {
    controls.appearance = form.appearance;
  }

  if (form.outfit.trim() !== "") {
    controls.outfit = form.outfit;
  }

  if (form.style !== null) {
    controls.style = form.style;
  }

  return controls;
}

/**
 * The seed the form's text stands for: none when blank, the number for digits, and NaN for
 * anything else, which no schema takes (the form says so).
 */
export function seedOf(form: BuilderForm) {
  const text = form.seed.trim();

  return text === "" ? undefined : /^\d+$/.test(text) ? Number(text) : Number.NaN;
}

/** The form with the description and controls a stored caption recipe holds. */
export function withDescribed(
  form: BuilderForm,
  described: { controls?: CharacterControls | null; description: string | null },
): BuilderForm {
  return {
    ...form,
    appearance: described.controls?.appearance ?? "",
    description: described.description ?? "",
    outfit: described.controls?.outfit ?? "",
    style: described.controls?.style ?? null,
  };
}

/** What a character was described with, as the form or a stored recipe holds it. */
type Described = { controls?: CharacterControls | null; description: string | null };

/**
 * The caption a hand-written caption belongs to: the description and controls it was written
 * for, so changing them starts a new one, and coming back to them finds it again.
 */
export function manualBasis(form: BuilderForm) {
  return `manual:${JSON.stringify([form.description.trim(), controlsOf(form)])}`;
}

/** The caption enhancement request for `described`, validated and normalized. */
export function captionRequest(described: Described) {
  return characterCaptionInputSchema.safeParse({
    controls: described.controls ?? {},
    description: described.description ?? "",
  });
}

/** Where a caption came from, as an image request names it. */
export type CaptionSource = NonNullable<CharacterGenerationInput["source"]>;

/** The source of a caption written for `described`, without an enhancement. */
export function writtenSource(described: Described): CaptionSource {
  const source: CaptionSource = { controls: described.controls ?? {} };

  if (described.description && described.description.trim() !== "") {
    source.description = described.description;
  }

  return source;
}

/**
 * The image request for exactly `caption` from `source`, with `seed` when one is given,
 * validated and normalized (the caption is never changed).
 */
export function imageRequest(caption: string, source: CaptionSource, seed: number | undefined) {
  return characterGenerationInputSchema.safeParse(
    seed === undefined ? { caption, source } : { caption, seed, source },
  );
}
