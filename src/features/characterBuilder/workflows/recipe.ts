import { z } from "zod";

/** Below 2^48, the largest range `randomInt` draws from, as the service's retries draw. */
export const SEED_RANGE = 2 ** 48 - 1;

export const seedSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** One model pin as a recipe records it (`lockedModels`). */
export const modelPinSchema = z.strictObject({
  file: z.string().min(1),
  license: z.string().min(1),
  sha256: sha256Schema,
});
