import { createHash } from "node:crypto";

import { z } from "zod";

import { database } from "./db.server.ts";

const accessCodeSchema = z
  .object({
    code_hash: z.string().regex(/^[a-f0-9]{64}$/),
    id: z.string().min(1),
    max_generations: z.int().nonnegative(),
    used: z.int().nonnegative(),
  })
  .optional();

/**
 * The access code `code` is, unless there is none or it was revoked. Codes are stored as their
 * SHA-256 (hex), as `scripts/mint-code.mjs` stores them.
 */
export function findAccessCode(code: string) {
  return accessCodeSchema.parse(
    database
      .prepare("SELECT * FROM access_codes WHERE code_hash = ? AND revoked_at IS NULL")
      .get(createHash("sha256").update(code).digest("hex")),
  );
}

/** The access code with this id, unless it was revoked. */
export function findAccessCodeById(id: string) {
  return accessCodeSchema.parse(
    database.prepare("SELECT * FROM access_codes WHERE id = ? AND revoked_at IS NULL").get(id),
  );
}
