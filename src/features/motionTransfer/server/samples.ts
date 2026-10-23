import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { storedAssetId, storeSampleFile } from "../../../shared/server/sample-files.ts";
import { MAX_CLIP_MS, MIN_CLIP_MS } from "../contracts.ts";

// Resolved from the working directory, like the workflows; the Dockerfile copies it.
const MOTIONS_DIRECTORY = resolve("src/features/motionTransfer/samples/motions");

const motionsManifestSchema = z.object({
  motions: z
    .array(
      z.object({
        attribution: z.string().min(1),
        license: z.string().min(1),
        // What ffprobe reads from the file (`tests/samples.test.ts` checks it), so seeding stays
        // synchronous and needs no FFmpeg.
        probe: z.object({
          duration_ms: z.int().min(MIN_CLIP_MS).max(MAX_CLIP_MS),
          fps: z.number().positive(),
          has_audio: z.boolean(),
          height: z.int().positive(),
          width: z.int().positive(),
        }),
        slug: z.string().regex(/^[a-z0-9-]+$/),
        title: z.string().min(1),
        video: z.string().regex(/^[a-z0-9-]+\.mp4$/),
      }),
    )
    .min(1),
});

/**
 * Upserts the sample motions by slug: those of
 * `src/features/motionTransfer/samples/motions/manifest.json`, each with its clip as a `sample`
 * video asset. Motion Transfer's seeder: `src/app/server.ts` (`seedDatabase`) runs it in one
 * transaction at every server start, before the first request, and wherever a database is
 * prepared without the server; running it again changes nothing. The sample characters are the
 * characters feature's (`seedSampleCharacters`).
 */
export function seedSampleMotions(database: DatabaseSync) {
  const now = new Date().toISOString();

  const { motions } = motionsManifestSchema.parse(
    JSON.parse(readFileSync(resolve(MOTIONS_DIRECTORY, "manifest.json"), "utf8")),
  );

  for (const sample of motions) {
    const bytes = readFileSync(resolve(MOTIONS_DIRECTORY, sample.video));
    const sha256 = storeSampleFile(bytes, "mp4");
    const { probe } = sample;

    database
      .prepare(
        `INSERT INTO assets (id, sha256, kind, role, path, mime, bytes, width, height, duration_ms,
  fps, has_audio, created_at)
VALUES (?, ?, 'video', 'sample', ?, 'video/mp4', ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (sha256) DO NOTHING`,
      )
      .run(
        randomUUID(),
        sha256,
        `${sha256}.mp4`,
        bytes.length,
        probe.width,
        probe.height,
        probe.duration_ms,
        probe.fps,
        Number(probe.has_audio),
        now,
      );

    database
      .prepare(
        `INSERT INTO motions (id, slug, title, source_asset_id, license, attribution, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (slug) DO UPDATE SET title = excluded.title,
  source_asset_id = excluded.source_asset_id, license = excluded.license,
  attribution = excluded.attribution`,
      )
      .run(
        randomUUID(),
        sample.slug,
        sample.title,
        storedAssetId(database, sha256),
        sample.license,
        sample.attribution,
        now,
      );
  }
}
