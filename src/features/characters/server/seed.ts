import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { storedAssetId, storeSampleFile } from "../../../shared/server/sample-files.ts";
import type { CharacterProvenance } from "../contracts.ts";

// Resolved from the working directory, like the workflows; the Dockerfile copies every
// feature's `samples/`.
const CHARACTERS_DIRECTORY = resolve("src/features/characters/samples/characters");

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const charactersManifestSchema = z.object({
  characters: z
    .array(
      z.object({
        caption: z.string().min(1),
        image: z.string().regex(/^[a-z0-9-]+\.png$/),
        image_sha256: sha256Schema,
        license: z.string().min(1),
        provenance: z.object({
          models: z
            .array(z.object({ file: z.string(), license: z.string(), sha256: sha256Schema }))
            .min(1),
          workflow: z.object({ id: z.string(), sha256: sha256Schema, version: z.int().positive() }),
        }),
        recipe: z.string().regex(/^[a-z0-9-]+\.recipe\.json$/),
        recipe_sha256: sha256Schema,
        seed: z.int().nonnegative(),
        slug: z.string().regex(/^[a-z0-9-]+$/),
        title: z.string().min(1),
      }),
    )
    .min(1),
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Upserts the sample characters by slug: those of
 * `src/features/characters/samples/characters/manifest.json`, each with its PNG as a `sample`
 * image asset (`is_sample = 1`, `origin = 'generated'`), the caption it was rendered from as its
 * `prompt` and the workflow and model pins of its builder recipe as its `provenance`. A sample the
 * manifest no longer lists is deleted (a generation that named it keeps its id and shows no
 * character). The characters feature's seeder: `src/app/server.ts` (`seedDatabase`) runs it in
 * one transaction at every server start, before the first request, and wherever a database is
 * prepared without the server; running it again changes nothing. A sample's image is public
 * (`charactersAccess`).
 */
export function seedSampleCharacters(database: DatabaseSync) {
  const now = new Date().toISOString();

  const { characters } = charactersManifestSchema.parse(
    JSON.parse(readFileSync(resolve(CHARACTERS_DIRECTORY, "manifest.json"), "utf8")),
  );

  for (const sample of characters) {
    const bytes = readFileSync(resolve(CHARACTERS_DIRECTORY, sample.image));

    // The IHDR chunk comes first and holds the width and height.
    if (
      !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
      bytes.toString("latin1", 12, 16) !== "IHDR"
    ) {
      throw new Error(`src/features/characters/samples/characters/${sample.image} is not a PNG`);
    }

    // The manifest's provenance is the render's only while the file is that render, byte for byte;
    // checked before anything is stored.
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    if (sha256 !== sample.image_sha256) {
      throw new Error(
        `src/features/characters/samples/characters/${sample.image} is not the render its manifest entry names (SHA-256 ${sha256}, not ${sample.image_sha256})`,
      );
    }

    storeSampleFile(bytes, "png");

    database
      .prepare(
        `INSERT INTO assets (id, sha256, kind, role, path, mime, bytes, width, height, created_at)
VALUES (?, ?, 'image', 'sample', ?, 'image/png', ?, ?, ?, ?)
ON CONFLICT (sha256) DO NOTHING`,
      )
      .run(
        randomUUID(),
        sha256,
        `${sha256}.png`,
        bytes.length,
        bytes.readUInt32BE(16),
        bytes.readUInt32BE(20),
        now,
      );

    const provenance: CharacterProvenance = sample.provenance;

    database
      .prepare(
        `INSERT INTO characters (id, slug, title, image_asset_id, origin, prompt, provenance,
  is_sample, created_at)
VALUES (?, ?, ?, ?, 'generated', ?, ?, 1, ?)
ON CONFLICT (slug) DO UPDATE SET title = excluded.title, image_asset_id = excluded.image_asset_id,
  prompt = excluded.prompt, provenance = excluded.provenance
WHERE is_sample = 1`,
      )
      .run(
        randomUUID(),
        sample.slug,
        sample.title,
        storedAssetId(database, sha256),
        sample.caption,
        JSON.stringify(provenance),
        now,
      );
  }

  database
    .prepare(
      "DELETE FROM characters WHERE is_sample = 1 AND slug NOT IN (SELECT value FROM json_each(?))",
    )
    .run(JSON.stringify(characters.map(({ slug }) => slug)));
}
