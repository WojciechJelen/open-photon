import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { assetSchema } from "../lib/contracts.ts";
import { database } from "./db.server.ts";
import { assetsDirectory } from "./media.server.ts";

const storedAssetSchema = assetSchema.extend({
  has_audio: z
    .union([z.literal(0), z.literal(1), z.null()])
    .transform((value) => (value === null ? null : value === 1)),
  /** The file name inside `assetsDirectory()`: `<sha256>.<ext>`. */
  path: z.string(),
});

export type StoredAsset = z.output<typeof storedAssetSchema>;

export type NewAsset = Omit<StoredAsset, "created_at" | "id" | "path"> & { ext: string };

/** A fresh hidden path in the assets directory, so the finished file moves into place with one rename. */
export async function incomingPath() {
  const directory = assetsDirectory();
  await mkdir(directory, { recursive: true });

  return resolve(directory, `.incoming-${randomUUID()}.part`);
}

export async function hashFile(path: string, signal?: AbortSignal) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(path, { signal })) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

function findBySha256(sha256: string) {
  const row = database.prepare("SELECT * FROM assets WHERE sha256 = ?").get(sha256);

  return row ? storedAssetSchema.parse(row) : null;
}

/**
 * Moves a finished `incomingPath()` file to `<sha256>.<ext>` and records it. Assets are
 * content-addressed: when the hash is already stored, the new file is deleted and the stored row
 * returned with `created: false`.
 */
export async function storeAsset(temporary: string, asset: NewAsset) {
  const existing = findBySha256(asset.sha256);

  if (existing) {
    await rm(temporary, { force: true });

    return { asset: existing, created: false };
  }

  const path = `${asset.sha256}.${asset.ext}`;
  // Two concurrent uploads of the same bytes both get here; the rename replaces equal content.
  await rename(temporary, resolve(assetsDirectory(), path));

  const result = database
    .prepare(
      `INSERT INTO assets (id, sha256, kind, role, source_asset_id, path, mime, bytes, width, height,
  duration_ms, fps, has_audio, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (sha256) DO NOTHING`,
    )
    .run(
      randomUUID(),
      asset.sha256,
      asset.kind,
      asset.role,
      asset.source_asset_id,
      path,
      asset.mime,
      asset.bytes,
      asset.width,
      asset.height,
      asset.duration_ms,
      asset.fps,
      asset.has_audio === null ? null : Number(asset.has_audio),
      new Date().toISOString(),
    );

  const stored = findBySha256(asset.sha256);

  if (!stored) {
    throw new Error("Could not store the asset");
  }

  return { asset: stored, created: result.changes === 1 };
}
