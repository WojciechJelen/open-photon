/** Starter chips for the look: each adds its phrase to the description, and takes it out again. */
export const starters = [
  { label: "Neon street at night", phrase: "Background: a neon-lit city street at night." },
  {
    label: "Plain studio backdrop",
    phrase: "Background: a plain grey studio backdrop, soft light.",
  },
  { label: "Golden-hour rooftop", phrase: "Background: a rooftop at golden hour." },
];

/**
 * The look with `phrase` added, or taken out when it is there. Only the one space that joined the
 * phrase to its text changes: the rest of the visitor's words, line breaks and spacing stay as
 * typed, since every character of the prompt is part of the recipe and its hash.
 */
export function toggleStarter(look: string, phrase: string) {
  const at = look.indexOf(phrase);

  if (at === -1) {
    return look === "" || /\s$/.test(look) ? `${look}${phrase}` : `${look} ${phrase}`;
  }

  const end = at + phrase.length;

  if (look[at - 1] === " ") {
    return look.slice(0, at - 1) + look.slice(end);
  }

  return look.slice(0, at) + look.slice(look[end] === " " ? end + 1 : end);
}
