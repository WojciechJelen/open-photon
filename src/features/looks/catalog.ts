// The looks catalog: the backgrounds, lighting and color/style looks the Direct step offers
// (`components/look-editor.tsx`). Each option is a fixed prompt fragment, benchmarked on the real
// Motion Transfer workflow (`docs/look-benchmark-2026-10-23/index.md`, one character, one clip):
// the sunny beach changed the take's background; the neon street did too, but the clip is itself
// a neon street, so its description says so; the lighting and color phrasings did not visibly
// change the take, so they are `experimental`, and a background that asked for what the photo
// already showed (a white studio) was dropped. Client-safe
// and loadable by Node (`npm run test:server`), so it holds no images: the previews are in
// `components/previews.ts`.
//
// Versioning: an option's `id` never changes; its `version` goes up whenever its `fragment` does.
// What a take sends is the composed text, which its recipe stores as `params.prompt`: a re-run and
// a retry never read this file. A shot started from a take ("Change the shot", the remixes) reads
// its picks back with `readLook`; a fragment no longer in the catalog stays in the visitor's own
// words, so the prompt is unchanged until it is edited.

/** The groups, in the order their fragments follow the visitor's description. */
export const lookGroups = ["background", "lighting", "look"] as const;

export type LookGroup = (typeof lookGroups)[number];

/**
 * `reliable`: the benchmark showed the effect. `experimental`: offered, but the benchmark did not
 * show a dependable effect, which the editor says.
 */
type LookEvidence = "experimental" | "reliable";

export type LookOption = {
  /** Options it cannot be combined with, in other groups: picking one drops the other. */
  conflicts: readonly string[];
  /** What the option does, as the editor shows it. */
  description: string;
  evidence: LookEvidence;
  /** The exact text it adds to the prompt: one sentence, unique in the catalog. */
  fragment: string;
  group: LookGroup;
  /** Stable, unique across groups. */
  id: string;
  label: string;
  version: number;
};

/**
 * Leads the prompt when the visitor wrote no description of their own: it keeps the character of
 * the reference image, as the workflow's default prompt does.
 */
export const characterBase = "The character from the reference image, as it appears there.";

/**
 * Follows `characterBase` when no background is picked: together they are the workflow's default
 * prompt (`src/features/motionTransfer/workflows/defaults.json`).
 */
export const backgroundBase = "Background as in the reference image.";

export const lookCatalog = {
  version: 1,
  options: [
    {
      conflicts: ["golden-hour"],
      description:
        "A city street at night, pink and blue signs on wet pavement. Tested only with a clip already filmed on such a street.",
      evidence: "reliable",
      fragment:
        "Background: a neon-lit city street at night, wet pavement reflecting pink and blue signs.",
      group: "background",
      id: "neon-street",
      label: "Neon street",
      version: 1,
    },
    {
      conflicts: [],
      description: "Sand, sea and a blue sky behind the character.",
      evidence: "reliable",
      fragment: "Background: a sunny sandy beach with the blue sea and sky behind.",
      group: "background",
      id: "beach",
      label: "Sunny beach",
      version: 1,
    },
    {
      conflicts: ["neon-street"],
      description: "Warm, low sunlight with long soft shadows.",
      evidence: "experimental",
      fragment: "Lighting: warm golden-hour sunlight from a low angle, long soft shadows.",
      group: "lighting",
      id: "golden-hour",
      label: "Golden hour",
      version: 1,
    },
    {
      conflicts: [],
      description: "Hard light from one side, deep shadows.",
      evidence: "experimental",
      fragment: "Lighting: dramatic low-key light from one side, deep shadows.",
      group: "lighting",
      id: "low-key",
      label: "Low-key",
      version: 1,
    },
    {
      conflicts: ["noir"],
      description: "Magenta and cyan light on the character.",
      evidence: "experimental",
      fragment: "Lighting: magenta and cyan neon light on the character.",
      group: "lighting",
      id: "neon-glow",
      label: "Neon glow",
      version: 1,
    },
    {
      conflicts: ["neon-glow"],
      description: "Black and white, high contrast.",
      evidence: "experimental",
      fragment: "Look: black-and-white film noir, high contrast.",
      group: "look",
      id: "noir",
      label: "Noir",
      version: 1,
    },
    {
      conflicts: [],
      description: "Warm, faded colors with soft grain.",
      evidence: "experimental",
      fragment: "Look: warm vintage 35 mm film, soft grain, faded colors.",
      group: "look",
      id: "vintage-film",
      label: "Vintage film",
      version: 1,
    },
    {
      conflicts: [],
      description: "A cinematic teal-and-orange color grade.",
      evidence: "experimental",
      fragment: "Look: cinematic teal-and-orange color grade.",
      group: "look",
      id: "teal-orange",
      label: "Teal and orange",
      version: 1,
    },
  ],
} as const satisfies { options: readonly LookOption[]; version: number };

export type LookCatalog = { options: readonly LookOption[]; version: number };

/** A catalog option whose effect the benchmark showed: the editor shows it with its preview. */
export type ReliableLookOption = Extract<
  (typeof lookCatalog.options)[number],
  { evidence: "reliable" }
>;
