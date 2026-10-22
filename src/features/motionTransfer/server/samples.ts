import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import { assetsDirectory } from "../../../shared/server/paths.ts";
import { MAX_CLIP_MS, MIN_CLIP_MS } from "../contracts.ts";

// Resolved from the working directory, like the workflows; the Dockerfile copies it.
const SAMPLES_DIRECTORY = resolve("src/features/motionTransfer/samples");

const charactersManifestSchema = z.object({
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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readManifest<T extends z.ZodType>(kind: "characters" | "motions", schema: T) {
  return schema.parse(
    JSON.parse(readFileSync(resolve(SAMPLES_DIRECTORY, kind, "manifest.json"), "utf8")),
  );
}

/** Writes a sample's bytes to `<sha256>.<ext>` in the assets directory once; returns the hash. */
function storeSampleFile(bytes: Buffer, ext: "mp4" | "png") {
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
function assetId(database: DatabaseSync, sha256: string) {
  return z
    .object({ id: z.string() })
    .parse(database.prepare("SELECT id FROM assets WHERE sha256 = ?").get(sha256)).id;
}

function seedCharacters(database: DatabaseSync, now: string) {
  for (const sample of readManifest("characters", charactersManifestSchema).characters) {
    const bytes = readFileSync(resolve(SAMPLES_DIRECTORY, "characters", sample.image));

    // The IHDR chunk comes first and holds the width and height.
    if (
      !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
      bytes.toString("latin1", 12, 16) !== "IHDR"
    ) {
      throw new Error(
        `src/features/motionTransfer/samples/characters/${sample.image} is not a PNG`,
      );
    }

    const sha256 = storeSampleFile(bytes, "png");

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

    database
      .prepare(
        `INSERT INTO characters (id, slug, title, image_asset_id, origin, is_sample, created_at)
VALUES (?, ?, ?, ?, 'generated', 1, ?)
ON CONFLICT (slug) DO UPDATE SET title = excluded.title, image_asset_id = excluded.image_asset_id
WHERE is_sample = 1`,
      )
      .run(randomUUID(), sample.slug, sample.title, assetId(database, sha256), now);
  }
}

function seedMotions(database: DatabaseSync, now: string) {
  for (const sample of readManifest("motions", motionsManifestSchema).motions) {
    const bytes = readFileSync(resolve(SAMPLES_DIRECTORY, "motions", sample.video));
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
        assetId(database, sha256),
        sample.license,
        sample.attribution,
        now,
      );
  }
}

/**
 * Upserts the samples by slug: the characters of `src/features/motionTransfer/samples/characters/manifest.json`, each with
 * its PNG as a `sample` asset, and the motions of `src/features/motionTransfer/samples/motions/manifest.json`, each with its
 * clip as a `sample` video asset. Motion Transfer's seeder: `src/app/server.ts` (`seedDatabase`)
 * runs it in one transaction at every server start, before the first request, and wherever a
 * database is prepared without the server; running it again changes nothing.
 */
export function seedSamples(database: DatabaseSync) {
  const now = new Date().toISOString();

  seedCharacters(database, now);
  seedMotions(database, now);
}
