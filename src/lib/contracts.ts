import { z } from "zod";

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

export type Asset = z.infer<typeof assetSchema>;

/**
 * A motion of the library (`samples/motions/manifest.json`, the `motions` table): a 3–8 s
 * `sample` clip, used as stored, with its license and attribution.
 */
export const sampleMotionSchema = z.object({
  attribution: z.string(),
  clip: assetSchema,
  id: z.uuid(),
  license: z.string(),
  slug: z.string(),
  title: z.string(),
});

export type SampleMotion = z.infer<typeof sampleMotionSchema>;

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

export type UploadedVideo = z.infer<typeof uploadedVideoSchema>;

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

/** A character with its reference image's asset, as the picker shows it. */
export const pickableCharacterSchema = characterSchema.extend({ image: assetSchema });

export type PickableCharacter = z.infer<typeof pickableCharacterSchema>;

/**
 * The input of the `generate` server function. The motion is a stored, probed video asset of
 * 3–8 s (`motion_asset_id`): a sample motion's clip, an upload, or a trimmed cut of one. The
 * character must be a generated one or an upload with consent. `prompt` (appearance and
 * background) defaults to the workflow's own, `seed` to a random one. `angle` is the id of a
 * reshoot-angle preset of `workflows/angles.json`; its phrasing is appended to the prompt, and
 * an unknown id is refused. The result is `{ id, reused }`: `reused` when a generation with the
 * same recipe is done or still on its way, in which case nothing is submitted.
 */
export const generateInputSchema = z.object({
  angle: z
    .string()
    .regex(/^[a-z][a-z-]*$/)
    .optional(),
  character_id: z.uuid(),
  motion_asset_id: z.uuid(),
  prompt: z.string().trim().min(1).max(500).optional(),
  seed: z.int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});

/** A reshoot-angle preset as the generate form offers it. */
export type AngleChoice = { id: string; label: string };

/**
 * `preparing → queued → running → finalizing → done | failed`. `unknown`: the server stopped
 * between sending the job to Comfy and saving its id, so Comfy may be rendering it; such a row
 * is never submitted again (README, "Generation state and recovery").
 */
export const generationStatusSchema = z.enum([
  "preparing",
  "queued",
  "running",
  "finalizing",
  "done",
  "failed",
  "unknown",
]);

/**
 * Why a generation is `failed` or `unknown`; `error_message` says it in words.
 *
 * - `provider_rejected`: Comfy refused an upload, the graph or the job (a 4xx answer).
 * - `provider_failed`: the job failed or was cancelled on Comfy, or finished without its MP4.
 * - `provider_unreachable`: the connection to Comfy failed, so nothing reached it.
 * - `timeout`: a request to Comfy ran out of time, or the job expired there.
 * - `interrupted`: the server stopped before sending the job; nothing was submitted.
 * - `unknown`: anything else, including an `unknown` row (the job may exist on Comfy).
 */
export const generationErrorCodeSchema = z.enum([
  "provider_rejected",
  "provider_failed",
  "provider_unreachable",
  "timeout",
  "interrupted",
  "unknown",
]);

/**
 * A generation as `GET /api/generations/:id` and its event stream return it. A `done` row has
 * `final_asset_id` (the MP4) and `poster_asset_id` (a JPEG), both served at
 * `/media/<asset id>.<mp4|jpg>`.
 */
export const generationSchema = z.object({
  character_id: z.uuid().nullable(),
  created_at: z.iso.datetime(),
  error_code: generationErrorCodeSchema.nullable(),
  error_message: z.string().nullable(),
  final_asset_id: z.uuid().nullable(),
  finished_at: z.iso.datetime().nullable(),
  id: z.uuid(),
  parent_id: z.uuid().nullable(),
  poster_asset_id: z.uuid().nullable(),
  progress: z.int().min(0).max(100).nullable(),
  status: generationStatusSchema,
  submitted_at: z.iso.datetime().nullable(),
});

export type GenerationSnapshot = z.infer<typeof generationSchema>;

/**
 * `GET /api/generations/:id/events` (`text/event-stream`): one `data:` line per snapshot of the
 * generation, a `: ping` comment every 15 s, and the stream ends once the generation is `done`,
 * `failed` or `unknown`. A finished generation gets one snapshot and no call to Comfy.
 */
export const generationEventSchema = z.object({
  generation: generationSchema,
  kind: z.literal("snapshot"),
});
