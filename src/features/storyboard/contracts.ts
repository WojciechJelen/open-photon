// The storyboard feature's contracts: a storyboard is one library character in four ordered scene
// cards, each card one image generation of its own (the shared image edit, the character as the
// reference), so a card can be regenerated or retried without touching the others. The scenes
// come from the user's short sequence, split into four by an open-weights text model
// (`storyboard-scenes.v1`), or are written by hand; either way they stay editable. Client-safe,
// and loadable by Node as is (relative `.ts` imports), so `npm run test:server` exercises them.
import { z } from "zod";

import { assetSchema, generationSchema, generationStatusSchema } from "../../shared/contracts.ts";

/** How many scene cards a storyboard has. */
export const CARD_COUNT = 4;

/** The scene split's workflow id, and its one text output. */
export const STORYBOARD_SCENES_WORKFLOW = "storyboard-scenes";

export const SCENES_OUTPUT = "scenes";

const seedSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** The sequence a user describes: trimmed, 1–1000 characters. */
export const sequenceSchema = z.string().trim().min(1).max(1000);

/** A storyboard's title: trimmed, at most 80 characters; blank is none. */
export const storyboardTitleSchema = z
  .string()
  .trim()
  .max(80)
  .transform((title) => title || null);

/** One card's scene description as a user edits it: trimmed, at most 1000 characters, may be blank. */
export const sceneDescriptionSchema = z.string().trim().max(1000);

/** Every card's description, in order. */
export const sceneDescriptionsSchema = z.array(sceneDescriptionSchema).length(CARD_COUNT);

/**
 * The look every card's prompt asks for: one of the character builder's styles, named in each
 * card's prompt, or `reference`, the reference image's own (the API's default). Naming it keeps
 * the four cards in one look; with `reference` alone an anime character drifted towards photoreal
 * on Comfy Cloud (`docs/feature-evidence/storyboard/`).
 */
export const storyboardStyles = [
  "realistic",
  "stylized-3d",
  "illustration",
  "anime",
  "reference",
] as const;

export type StoryboardStyle = (typeof storyboardStyles)[number];

const STYLE_PHRASES: Record<StoryboardStyle, string> = {
  anime: "as an anime-style illustration in the same visual style as the reference image",
  illustration: "as a digital illustration in the same visual style as the reference image",
  realistic: "as a photograph in the same visual style as the reference image",
  reference: "in the same visual style as the reference image",
  "stylized-3d": "as a stylized 3D render in the same visual style as the reference image",
};

/** Each card's output size: landscape 16:9-ish, about 1 MP, multiples of 16. */
export const CARD_SIZE = { height: 768, width: 1344 } as const;

/**
 * The image edit prompt of one card: the scene, framed as one storyboard frame of the reference
 * image's person (the edit's one reference, the storyboard's character), with the identity and
 * the shared look spelled out the same way for every card, so the four stay one character in
 * one style. Pure; the server computes it, a client only shows it.
 */
export function compileCardPrompt(description: string, style: StoryboardStyle) {
  return [
    "A storyboard frame. The character is the person in the reference image.",
    description.trim(),
    "Keep the character's face, hair, body and outfit exactly as in the reference image.",
    `Render it ${STYLE_PHRASES[style]}, cinematic wide 16:9 composition, no text, no captions, no borders.`,
  ].join(" ");
}

/**
 * The scene split's request body (`storyboard-scenes.v1`, also what `POST /api/storyboards`
 * submits for a storyboard without its own scenes): the sequence and an optional seed.
 */
export const storyboardScenesInputSchema = z.strictObject({
  seed: seedSchema.optional(),
  sequence: sequenceSchema,
});

export type StoryboardScenesInput = z.output<typeof storyboardScenesInputSchema>;

/**
 * `POST /api/storyboards` JSON body, plus a required `request_key` (a UUID): the library
 * character (`character_id`), the sequence, the style (`reference` by default), an optional
 * title, and optional `scenes`, four descriptions written by hand. Without `scenes`, the text model splits the sequence into four
 * (a generation of `storyboard-scenes`, followed as the storyboard's `scenes.generation`).
 */
export const createStoryboardInputSchema = z.object({
  character_id: z.uuid(),
  scenes: sceneDescriptionsSchema.optional(),
  sequence: sequenceSchema,
  style: z.enum(storyboardStyles).default("reference"),
  title: storyboardTitleSchema.optional(),
});

export type CreateStoryboardInput = z.output<typeof createStoryboardInputSchema>;

/** What a client sends: `CreateStoryboardInput` before defaults and trimming. */
export type CreateStoryboardBody = z.input<typeof createStoryboardInputSchema>;

/**
 * `PUT /api/storyboards/:id` JSON body: the title, the style and every card's description, saved
 * as given. A card's generations keep what they rendered; the next one renders the saved text.
 */
export const saveStoryboardInputSchema = z.object({
  descriptions: sceneDescriptionsSchema,
  style: z.enum(storyboardStyles),
  title: storyboardTitleSchema,
});

export type SaveStoryboardInput = z.output<typeof saveStoryboardInputSchema>;

export type SaveStoryboardBody = z.input<typeof saveStoryboardInputSchema>;

const positionSchema = z
  .int()
  .min(0)
  .max(CARD_COUNT - 1);

/**
 * `POST /api/storyboards/:id/generations` JSON body, plus a required `request_key`: the
 * storyboard as `PUT` saves it (saved first) and the cards to render now (`positions`, 0-based,
 * distinct). Each named card must have a description. Every other card keeps its generation.
 */
export const generateCardsInputSchema = saveStoryboardInputSchema.extend({
  positions: z
    .array(positionSchema)
    .min(1)
    .max(CARD_COUNT)
    .refine((positions) => new Set(positions).size === positions.length, {
      message: "Name each card once.",
    }),
});

export type GenerateCardsInput = z.output<typeof generateCardsInputSchema>;

export type GenerateCardsBody = z.input<typeof generateCardsInputSchema>;

/**
 * Where a storyboard's scenes come from: `manual` (written by hand when it was made), `writing`
 * (the split is on its way), `ready` (the split is done and gave four scenes), `failed` (the
 * split failed, or its text did not hold four scenes: `message` says which; the cards are blank
 * and editable, and a failed split can be retried).
 */
export const scenesStateSchema = z.enum(["manual", "writing", "ready", "failed"]);

/**
 * A card as the API shows it: its position, its description (the saved one, else the split's
 * scene, else blank), and its current generation (`null` before the first), followed through a
 * failed one's shared retry like a batch item; `attempt` counts those retries, `seed` is what it
 * renders with and `history` how many generations the card has had.
 */
export const storyboardCardSchema = z.object({
  attempt: z.int().nonnegative(),
  description: z.string(),
  generation: generationSchema.nullable(),
  history: z.int().nonnegative(),
  position: positionSchema,
  seed: seedSchema.nullable(),
});

export type StoryboardCard = z.output<typeof storyboardCardSchema>;

/** `GET /api/storyboards/:id`, and the answer of every write to one. */
export const storyboardSchema = z.object({
  cards: z.array(storyboardCardSchema).length(CARD_COUNT),
  character: z.object({
    id: z.uuid(),
    image: assetSchema,
    origin: z.enum(["generated", "upload"]),
    title: z.string().nullable(),
  }),
  created_at: z.iso.datetime(),
  id: z.uuid(),
  scenes: z.object({
    generation: generationSchema.nullable(),
    message: z.string().nullable(),
    state: scenesStateSchema,
  }),
  seed: seedSchema,
  sequence: z.string(),
  style: z.enum(storyboardStyles),
  title: z.string().nullable(),
  updated_at: z.iso.datetime(),
});

export type Storyboard = z.output<typeof storyboardSchema>;

/** `GET /api/storyboards`: the workspace's latest storyboards, each with its cards' statuses. */
export const storyboardListSchema = z.object({
  storyboards: z.array(
    z.object({
      character: storyboardSchema.shape.character,
      created_at: z.iso.datetime(),
      id: z.uuid(),
      statuses: z.array(generationStatusSchema.nullable()).length(CARD_COUNT),
      title: z.string().nullable(),
      updated_at: z.iso.datetime(),
    }),
  ),
});

export type StoryboardList = z.output<typeof storyboardListSchema>;

/**
 * The four scenes of the text model's answer: `Scene 1:` … `Scene 4:`, each up to the next
 * marker or the end (one per line as asked, or run together on one line), trimmed. `null`
 * unless all four are there, numbered 1–4 in order, and none is blank or longer than a card
 * takes. Nothing is guessed: an answer in another shape is reported, not repaired.
 */
export function parseScenes(text: string) {
  const found = [
    ...text.matchAll(/(?:^|\s)Scene\s+([1-9])\s*:\s*([\s\S]*?)(?=\s+Scene\s+[1-9]\s*:|$)/g),
  ];

  const scenes = found.map(([, number, body]) => ({
    number: Number(number),
    text: body?.trim() ?? "",
  }));

  const valid =
    scenes.length === CARD_COUNT &&
    scenes.every(
      ({ number, text: scene }, index) =>
        number === index + 1 && sceneDescriptionSchema.min(1).safeParse(scene).success,
    );

  return valid ? scenes.map(({ text: scene }) => scene) : null;
}
