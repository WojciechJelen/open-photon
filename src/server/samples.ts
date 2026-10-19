import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { assetsDirectory } from "./paths.ts";

// Resolved from the working directory, like `workflows/`; the Dockerfile copies it.
const SAMPLES_DIRECTORY = resolve("samples/characters");

const manifestSchema = z.object({
  characters: z
    .array(
      z.object({
        image: z.string().regex(/^[a-z0-9-]+\.png$/),
        slug: z.string().regex(/^[a-z0-9-]+$/),
        title: z.string().min(1),
      }),
    )
    .min(1),
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Upserts the sample characters of `samples/characters/manifest.json` (by slug), each with its
 * PNG as a `sample` asset. `db.server.ts` runs it in one transaction every time it opens the
 * database, right after the migrations, so every database has the samples before its first
 * query; running it again changes nothing.
 */
export function seedSamples(database: DatabaseSync) {
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(resolve(SAMPLES_DIRECTORY, "manifest.json"), "utf8")),
  );

  const directory = assetsDirectory();
  mkdirSync(directory, { recursive: true });

  for (const sample of manifest.characters) {
    const bytes = readFileSync(resolve(SAMPLES_DIRECTORY, sample.image));

    // The IHDR chunk comes first and holds the width and height.
    if (
      !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
      bytes.toString("latin1", 12, 16) !== "IHDR"
    ) {
      throw new Error(`samples/characters/${sample.image} is not a PNG`);
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `${sha256}.png`;
    const target = resolve(directory, path);

    if (!existsSync(target)) {
      const temporary = resolve(directory, `.incoming-${randomUUID()}.part`);
      writeFileSync(temporary, bytes);
      renameSync(temporary, target);
    }

    const now = new Date().toISOString();

    database
      .prepare(
        `INSERT INTO assets (id, sha256, kind, role, path, mime, bytes, width, height, created_at)
VALUES (?, ?, 'image', 'sample', ?, 'image/png', ?, ?, ?, ?)
ON CONFLICT (sha256) DO NOTHING`,
      )
      .run(
        randomUUID(),
        sha256,
        path,
        bytes.length,
        bytes.readUInt32BE(16),
        bytes.readUInt32BE(20),
        now,
      );

    const { id } = z
      .object({ id: z.string() })
      .parse(database.prepare("SELECT id FROM assets WHERE sha256 = ?").get(sha256));

    database
      .prepare(
        `INSERT INTO characters (id, slug, title, image_asset_id, origin, is_sample, created_at)
VALUES (?, ?, ?, ?, 'generated', 1, ?)
ON CONFLICT (slug) DO UPDATE SET title = excluded.title, image_asset_id = excluded.image_asset_id
WHERE is_sample = 1`,
      )
      .run(randomUUID(), sample.slug, sample.title, id, now);
  }
}
