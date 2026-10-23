import { z } from "zod";

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

// Generations, whatever workflow made them (`src/shared/server/generation/`). There is one
// workspace per installation: who may start, read or share a generation is decided on the server
// from the request's access-code session, never from anything a client sends.

/**
 * `waiting → preparing → queued → running → finalizing → done | failed`. `waiting`: admitted while
 * every place in flight was taken (`IN_FLIGHT_MAX`), in line for the server's dispatcher, nothing
 * sent to Comfy yet; it can be `cancelled` (nothing rendered, nothing charged). `unknown`: the
 * server stopped between sending the job to Comfy and saving its id, so Comfy may be rendering it;
 * such a row is never submitted again (docs/priv/motion-transfer.md, "Generation state and
 * recovery").
 */
export const generationStatusSchema = z.enum([
  "waiting",
  "preparing",
  "queued",
  "running",
  "finalizing",
  "done",
  "failed",
  "unknown",
  "cancelled",
]);

/**
 * Why a generation is `failed` or `unknown`; `error_message` says it in words.
 *
 * - `provider_rejected`: Comfy refused an upload, the graph or the job (a 4xx answer).
 * - `provider_failed`: the job failed or was cancelled on Comfy, or finished without one of the
 *   outputs its workflow declares.
 * - `provider_unreachable`: the connection to Comfy failed, so nothing reached it.
 * - `timeout`: a request to Comfy ran out of time, or the job expired there.
 * - `finalize_failed`: Comfy finished the job, but its output could not be downloaded or stored
 *   (three attempts); the job and its output stay in the Comfy account's history.
 * - `interrupted`: the server stopped before sending the job; nothing was submitted.
 * - `target_mismatch`: the job was submitted to another endpoint than the one this server
 *   renders on now, so it cannot be followed; the job may still exist there (Retry renders anew).
 * - `unknown`: anything else, including an `unknown` row (the job may exist on Comfy).
 */
const generationErrorCodeSchema = z.enum([
  "provider_rejected",
  "provider_failed",
  "provider_unreachable",
  "timeout",
  "finalize_failed",
  "interrupted",
  "target_mismatch",
  "unknown",
]);

/**
 * A generation as `GET /api/generations/:id` and its event stream return it. A `done` row has
 * `share_slug`: its public share page is `/r/<share_slug>`. Its files are its named outputs
 * (`generationOutputSchema`); `final_asset_id` and `poster_asset_id` name the outputs `video` (an
 * MP4) and `poster` (a JPEG) of the workflows that have them, as they did before outputs had
 * names, and are `null` for any other. `position` is a `waiting` generation's place in line (1:
 * the next to start), `null` in any other status.
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
  position: z.int().positive().nullable().default(null),
  poster_asset_id: z.uuid().nullable(),
  progress: z.int().min(0).max(100).nullable(),
  share_slug: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .nullable(),
  status: generationStatusSchema,
  submitted_at: z.iso.datetime().nullable(),
});

export type GenerationSnapshot = z.infer<typeof generationSchema>;

/**
 * `GET /api/generations/:id/events` (`text/event-stream`): one `data:` line per event, a `: ping`
 * comment every 15 s. A `snapshot` is the generation as stored (a `waiting` one with its
 * `position`, sent again whenever it moves up); the stream ends once it is `done`, `failed`,
 * `unknown` or `cancelled`, and a finished generation gets one snapshot and no call to Comfy.
 * `provider_unavailable` (with the stored generation, unchanged) says Comfy could not be asked
 * about it; the stream then ends with a `retry:` delay, and the browser reconnects after it.
 */
export const generationEventSchema = z.object({
  generation: generationSchema,
  kind: z.enum(["snapshot", "provider_unavailable"]),
});

export type GenerationEvent = z.infer<typeof generationEventSchema>;

/**
 * One named output of a done generation, as result and share pages get it: the `name` its
 * workflow declares (`video`, `image`, …, and `poster` for the still cut from a video output that
 * asks for one), what it is (`media`: the stored asset's kind) and the asset, served at
 * `/media/<asset id>.<ext>`. A page shows a generation by the media of its outputs.
 */
const generationOutputSchema = z.object({
  asset: assetSchema,
  media: assetSchema.shape.kind,
  name: z.string().min(1),
});

export type GenerationOutput = z.infer<typeof generationOutputSchema>;

/**
 * The answer to a request that starts a generation (`POST /api/generate`, a retry or a re-run):
 * the generation's `id`, and `reused` when an existing one with the same recipe (done, or still
 * on its way) is returned instead of submitting a new one. A new one admitted while every place
 * in flight is taken also says `status: "waiting"` and its `position` in line (a 202); otherwise
 * its status is the generation's own (`GET /api/generations/:id` and its events).
 */
export const generationReceiptSchema = z.object({
  id: z.uuid(),
  position: z.int().positive().optional(),
  reused: z.boolean(),
  status: z.literal("waiting").optional(),
});

export type GenerationReceipt = z.infer<typeof generationReceiptSchema>;
