import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { assetsDirectory } from "./paths.ts";

/**
 * Writes a sample's bytes to `<sha256>.<ext>` in the assets directory once; returns the hash. For
 * the features' seeders, which run synchronously at boot and record the asset row themselves.
 */
export function storeSampleFile(bytes: Buffer, ext: "mp4" | "png") {
  const directory = assetsDirectory();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const target = resolve(directory, `${sha256}.${ext}`);

  mkdirSync(directory, { recursive: true });

  if (!existsSync(target)) {
    const temporary = resolve(directory, `.incoming-${randomUUID()}.part`);
    writeFileSync(temporary, bytes);
    renameSync(temporary, target);
  }

  return sha256;
}

/** The id of the asset with this hash; a sample's bytes may already be stored as an upload. */
export function storedAssetId(database: DatabaseSync, sha256: string) {
  return z
    .object({ id: z.string() })
    .parse(database.prepare("SELECT id FROM assets WHERE sha256 = ?").get(sha256)).id;
}
