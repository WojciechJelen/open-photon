import { z } from "zod";

/** An image side the character generation renders: a multiple of 16 (FLUX.2's latent), 512–2048. */
export const imageSideSchema = z.int().min(512).max(2048).multipleOf(16);

/**
 * The JSON body of `POST /api/character-generations`: a text `prompt` describing the character
 * (1–1000 characters after trimming), an optional `seed` (a random one, resolved once, without
 * it) and an optional `width`/`height` (`workflows/defaults.json`'s portrait size without them).
 * The answer is `{ id, reused }`: `reused` when a generation with the same recipe is done or
 * still on its way, in which case nothing is submitted. The result is one PNG, the output
 * `image`, which `createFromGeneration` of the characters API saves as a character.
 */
export const characterGenerationInputSchema = z.object({
  height: imageSideSchema.optional(),
  prompt: z.string().trim().min(1).max(1000),
  seed: z.int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  width: imageSideSchema.optional(),
});

export type CharacterGenerationInput = z.output<typeof characterGenerationInputSchema>;
