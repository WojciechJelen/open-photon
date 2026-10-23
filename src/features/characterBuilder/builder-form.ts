// The builder's form as the requests take it: the controls without blanks, the seed as a number.
import type { BuilderForm } from "#/features/characterBuilder/builder-memory";
import type { CharacterControls, CharacterStyle } from "#/features/characterBuilder/contracts";

/** Each style as the form names it. */
export const styleLabels: Record<CharacterStyle, string> = {
  anime: "Anime",
  illustration: "Illustration",
  realistic: "Realistic",
  "stylized-3d": "Stylized 3D",
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
