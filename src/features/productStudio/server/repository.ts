// Product Studio's tables (`productStudio/001-product-shoots.sql`): a shoot's identity, its
// request key, its product and its shots' generation references, in order. Generations
// themselves are the generation service's; nothing here writes one.
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { database } from "../../../shared/server/db.server.ts";
import { productShotFormats, productShotPresets } from "../contracts.ts";

const shootRowSchema = z.object({
  access_code_id: z.string(),
  created_at: z.iso.datetime(),
  description: z.string().nullable(),
  format: z.enum(productShotFormats),
  id: z.uuid(),
  product: z.string(),
  product_asset_id: z.uuid(),
  request_key: z.string(),
});

export type ShootRow = z.output<typeof shootRowSchema>;

const itemRowSchema = z.object({
  generation_id: z.uuid(),
  position: z.int().nonnegative(),
  preset: z.enum(productShotPresets),
});

/** The shoot a request key admitted, `null` for a key no shoot has. */
export function findShootByKey(requestKey: string) {
  const row = database
    .prepare("SELECT * FROM product_shoots WHERE request_key = ?")
    .get(requestKey);

  return row ? shootRowSchema.parse(row) : null;
}

export function findShoot(id: string) {
  const row = database.prepare("SELECT * FROM product_shoots WHERE id = ?").get(id);

  return row ? shootRowSchema.parse(row) : null;
}

/** The workspace's shoots, most recent first (at most `limit`). */
export function listShoots(limit: number) {
  return z
    .array(shootRowSchema)
    .parse(
      database
        .prepare("SELECT * FROM product_shoots ORDER BY created_at DESC, id DESC LIMIT ?")
        .all(limit),
    );
}

/**
 * A shoot's shots in order, each with the generation it renders now: its first one, or the
 * newest child of the latest failed or cancelled attempt (the shared retry or re-run), and how
 * many attempts that took.
 */
export function findShots(shootId: string) {
  return z
    .array(itemRowSchema.extend({ attempt: z.int().nonnegative(), current_id: z.uuid() }))
    .parse(
      database
        .prepare(
          `WITH RECURSIVE attempts (position, generation_id, attempt) AS (
  SELECT position, generation_id, 0 FROM product_shoot_items WHERE shoot_id = ?
  UNION ALL
  SELECT attempts.position, (
    SELECT child.id FROM generations child WHERE child.parent_id = attempts.generation_id
    ORDER BY child.created_at DESC, child.rowid DESC LIMIT 1
  ), attempts.attempt + 1
  FROM attempts JOIN generations current ON current.id = attempts.generation_id
  WHERE current.status IN ('failed', 'cancelled')
    AND EXISTS (SELECT 1 FROM generations child WHERE child.parent_id = current.id)
)
SELECT items.position, items.preset, items.generation_id, latest.generation_id AS current_id,
  latest.attempt
FROM product_shoot_items items
JOIN attempts latest ON latest.position = items.position
WHERE items.shoot_id = ?
  AND latest.attempt = (SELECT max(attempt) FROM attempts WHERE position = items.position)
ORDER BY items.position`,
        )
        .all(shootId, shootId),
    );
}

/**
 * Stores a shoot and its shots, each with the generation `submitMany` answered for it. The caller
 * runs it in the transaction that admitted them, so a shoot exists exactly when its generations
 * do.
 */
export function insertShoot(shoot: {
  accessCodeId: string;
  description: string | null;
  format: ShootRow["format"];
  items: ReadonlyArray<{ generationId: string; preset: string; reused: boolean }>;
  product: string;
  productAssetId: string;
  requestKey: string;
}) {
  const id = randomUUID();

  database
    .prepare(
      `INSERT INTO product_shoots (id, request_key, access_code_id, product_asset_id, product,
  description, format, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      shoot.requestKey,
      shoot.accessCodeId,
      shoot.productAssetId,
      shoot.product,
      shoot.description,
      shoot.format,
      new Date().toISOString(),
    );

  const insertItem = database.prepare(
    "INSERT INTO product_shoot_items (shoot_id, position, preset, generation_id, reused) VALUES (?, ?, ?, ?, ?)",
  );

  for (const [position, item] of shoot.items.entries()) {
    insertItem.run(id, position, item.preset, item.generationId, item.reused ? 1 : 0);
  }

  return id;
}
