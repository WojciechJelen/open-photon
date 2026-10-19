import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { ServerRequest } from "srvx";
import { z } from "zod";

import {
  assetSchema,
  MAX_CLIP_MS,
  MIN_CLIP_MS,
  trimRequestSchema,
  uploadedVideoSchema,
  type VideoRejection,
} from "../lib/contracts.ts";
import { findAsset, hashFile, incomingPath, type StoredAsset, storeAsset } from "./assets.ts";
import { assetsDirectory } from "./media.server.ts";
import { classifyVideo, probe } from "./media/probe.ts";
import { trimVideo } from "./media/trim.ts";
import { handleUpload, UploadError } from "./upload.server.ts";

const rejections: Record<VideoRejection, string> = {
  no_video: "This file has no video we can read. Upload an MP4, MOV or WebM clip.",
  too_short: "This clip is shorter than 3 seconds.",
};

/** A range that comes out under 3 s once cut to whole frames (3000 ms at 30000/1001 fps is 2.97 s). */
class CutTooShortError extends Error {}

/**
 * Cuts `durationMs` from `startMs` of a stored video into a `trimmed` asset (deduplicated by
 * hash). The stored cut lasts 3 s to `durationMs`; `CutTooShortError` when it would be shorter.
 */
async function cutClip(
  source: StoredAsset,
  startMs: number,
  durationMs: number,
  signal: AbortSignal,
) {
  const temporary = await incomingPath();

  try {
    await trimVideo(
      resolve(assetsDirectory(), source.path),
      temporary,
      startMs,
      durationMs,
      signal,
    );

    const info = await probe(temporary, signal);

    if (!info?.video || info.durationMs === null) {
      throw new Error("FFmpeg wrote a trimmed clip that ffprobe cannot read");
    }

    if (info.durationMs > durationMs) {
      throw new Error(`FFmpeg cut ${info.durationMs} ms for a ${durationMs} ms range`);
    }

    if (info.durationMs < MIN_CLIP_MS) {
      throw new CutTooShortError();
    }

    return await storeAsset(temporary, {
      bytes: (await stat(temporary)).size,
      duration_ms: info.durationMs,
      ext: "mp4",
      fps: info.video.fps,
      has_audio: info.hasAudio,
      height: info.video.height,
      kind: "video",
      mime: "video/mp4",
      role: "trimmed",
      sha256: await hashFile(temporary, signal),
      source_asset_id: source.id,
      width: info.video.width,
    });
  } finally {
    await rm(temporary, { force: true });
  }
}

/** `POST /api/uploads`; the response contract is `uploadedVideoSchema`. */
export function uploadVideo(request: ServerRequest) {
  return handleUpload(request, "file", [], async (upload) => {
    const checked = classifyVideo(await probe(upload.temporary, request.signal));

    if ("reason" in checked) {
      throw new UploadError(422, rejections[checked.reason], checked.reason);
    }

    const { file } = checked;

    const { asset, created } = await storeAsset(upload.temporary, {
      bytes: upload.bytes,
      duration_ms: file.durationMs,
      ext: file.ext,
      fps: file.fps,
      has_audio: file.hasAudio,
      height: file.height,
      kind: "video",
      mime: file.mime,
      role: "upload",
      sha256: upload.sha256,
      source_asset_id: null,
      width: file.width,
    });

    const trimmed =
      file.durationMs > MAX_CLIP_MS
        ? (await cutClip(asset, 0, MAX_CLIP_MS, request.signal)).asset
        : null;

    return Response.json(uploadedVideoSchema.parse({ ...asset, trimmed }), {
      status: created ? 201 : 200,
    });
  });
}

/** `POST /api/assets/:id/trim`; the body is `trimRequestSchema`, the response an asset. */
export async function trimAsset(request: Request, assetId: string) {
  const body = trimRequestSchema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });
  }

  const source = findAsset(assetId);

  if (source?.kind !== "video" || source.duration_ms === null) {
    return Response.json({ error: "Video not found" }, { status: 404 });
  }

  const { duration_ms: durationMs, start_ms: startMs } = body.data;

  if (startMs + durationMs > source.duration_ms) {
    return Response.json({ error: "The range ends after the clip" }, { status: 422 });
  }

  try {
    const { asset, created } = await cutClip(source, startMs, durationMs, request.signal);

    return Response.json(assetSchema.parse(asset), { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof CutTooShortError) {
      return Response.json(
        {
          error: "This range is under 3 seconds once cut to whole frames. Choose a longer range.",
          reason: "too_short",
        },
        { status: 422 },
      );
    }

    throw error;
  }
}
