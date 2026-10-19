import { z } from "zod";

const presetSchema = z.enum(["cinematic", "portrait"]);

export const studioSearchSchema = z.object({
  job: z.uuid().optional().catch(undefined),
  preset: presetSchema.catch("cinematic"),
  take: z.coerce.number().int().min(1).max(9).catch(1),
});

export const newJobSchema = z.object({
  id: z.uuid(),
  preset: presetSchema,
  prompt: z.string().trim().min(1, "Write a prompt first.").max(500),
  take: z.number().int().min(1).max(9),
});

const jobBaseSchema = newJobSchema.extend({
  createdAt: z.iso.datetime(),
  message: z.string(),
  startedAt: z.number().int().nullable(),
});

export const videoOutputSchema = z.object({
  assetId: z.string().min(1),
  bytes: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  filename: z.string().regex(/^[a-f0-9-]+\.mp4$/),
  height: z.number().int().positive(),
  posterFilename: z.string().regex(/^[a-f0-9-]+\.jpg$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(),
});

export const jobRowSchema = z.discriminatedUnion("status", [
  jobBaseSchema.extend({
    completedAt: z.null(),
    percent: z.null(),
    providerJobId: z.null(),
    status: z.literal("submitting"),
  }),
  jobBaseSchema.extend({
    completedAt: z.null(),
    percent: z.number().int().min(0).max(99).nullable(),
    providerJobId: z.string().min(1),
    status: z.enum(["queued", "running", "downloading"]),
  }),
  jobBaseSchema.extend({
    completedAt: z.number().int(),
    output: videoOutputSchema,
    percent: z.literal(100),
    providerJobId: z.string().min(1),
    status: z.literal("complete"),
  }),
  jobBaseSchema.extend({
    completedAt: z.number().int(),
    errorCode: z.string(),
    percent: z.null(),
    providerJobId: z.string().nullable(),
    status: z.literal("failed"),
  }),
  jobBaseSchema.extend({
    completedAt: z.null(),
    errorCode: z.literal("submission_unknown"),
    percent: z.null(),
    providerJobId: z.null(),
    status: z.literal("unknown"),
  }),
]);

export type JobRow = z.infer<typeof jobRowSchema>;

export const jobEventSchema = z.object({
  job: jobRowSchema,
  kind: z.literal("snapshot"),
});

export type NewJob = z.infer<typeof newJobSchema>;

/** A driving clip is 3–8 s (docs/mvp-implementation-plan.md §3–4). */
export const MIN_CLIP_MS = 3000;

export const MAX_CLIP_MS = 8000;

/** An `assets` row as the API returns it (no server path). */
export const assetSchema = z.object({
  bytes: z.int().nonnegative(),
  created_at: z.iso.datetime(),
  duration_ms: z.int().nullable(),
  fps: z.number().nullable(),
  has_audio: z.boolean().nullable(),
  height: z.int().nullable(),
  id: z.uuid(),
  kind: z.enum(["video", "image", "poster"]),
  mime: z.string(),
  role: z.enum(["upload", "trimmed", "sample", "provider_output", "final", "poster"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  source_asset_id: z.uuid().nullable(),
  width: z.int().nullable(),
});

/**
 * `POST /api/uploads`: multipart, one MP4, QuickTime or WebM video in the field `file`, at most
 * 128 MiB. ffprobe decides what the file is, not its name.
 *
 * - 201 with the new upload asset; 200 with the stored one when the same bytes were uploaded
 *   before (assets are content-addressed).
 * - `trimmed` is `null` for a 3–8 s clip. A longer clip is kept whole and comes back with
 *   `trimmed` = its first 8 s (video and audio), usable as is; the trim UI shows the whole clip
 *   and, for another range, calls `POST /api/assets/:id/trim` (`trimRequestSchema`).
 * - 413 over 128 MiB (before anything is stored). 422 `{ error, reason }` with a
 *   `VideoRejection` reason: `no_video` (no readable video stream in a supported container) or
 *   `too_short` (under 3 s). A rejected file leaves no asset row and no file.
 * - Other errors are `{ error }` with 400 or 415.
 */
export const uploadedVideoSchema = assetSchema.extend({ trimmed: assetSchema.nullable() });

export type VideoRejection = "no_video" | "too_short";

/**
 * `POST /api/assets/:id/trim` JSON body: cut `duration_ms` (3–8 s) of a stored video from
 * `start_ms`. 201 with the new `trimmed` asset (`source_asset_id` = `:id`), 200 when the same cut
 * already exists; the cut is whole frames, at most `duration_ms` long and at least 3 s less one
 * frame (3000 ms at 30000/1001 fps is 89 frames, 2.97 s). 404 for an unknown or non-video
 * asset, 422 when the range ends after the clip, 422 `{ error, reason: "too_short" }` when the
 * cut comes out shorter than that, 400 for a malformed body.
 */
export const trimRequestSchema = z.object({
  duration_ms: z.int().min(MIN_CLIP_MS).max(MAX_CLIP_MS),
  start_ms: z.int().nonnegative(),
});

/**
 * A `characters` row. `POST /api/characters` takes multipart `image` (PNG, JPEG or WebP by
 * content, at most 128 MiB) and `consent=true`, the uploader's statement that they may use the
 * likeness. 201 with the new character (`origin: "upload"`, `consent_at` set), 200 with the
 * stored one when the same image was uploaded before. 422 `{ error, reason }` with
 * `consent_required` or `not_image`; nothing is stored then.
 */
export const characterSchema = z.object({
  consent_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  generation_id: z.uuid().nullable(),
  id: z.uuid(),
  image_asset_id: z.uuid(),
  is_sample: z.boolean(),
  origin: z.enum(["generated", "upload"]),
  prompt: z.string().nullable(),
  slug: z.string().nullable(),
  title: z.string().nullable(),
});
