import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import { MIN_CLIP_MS, type VideoRejection } from "../../lib/contracts.ts";

const execute = promisify(execFile);

/** Runs `ffmpeg` or `ffprobe` with errors only on stderr and no stdin. */
export function runTool(tool: "ffmpeg" | "ffprobe", args: string[], signal?: AbortSignal) {
  return execute(tool, ["-v", "error", ...(tool === "ffmpeg" ? ["-nostdin", "-y"] : []), ...args], {
    maxBuffer: 8 * 1024 * 1024,
    signal,
    timeout: 300_000,
  });
}

/** True when the tool ran and exited nonzero (it rejected its input), not when it failed to start, timed out or was aborted. */
export function exitedNonzero(error: Error) {
  return z.object({ code: z.int() }).safeParse(error).success;
}

const probeOutputSchema = z.object({
  format: z.object({
    duration: z.coerce.number().optional(),
    format_name: z.string(),
    tags: z.object({ major_brand: z.string().optional() }).optional(),
  }),
  streams: z.array(
    z.object({
      avg_frame_rate: z.string().optional(),
      codec_name: z.string().optional(),
      codec_type: z.string().optional(),
      disposition: z.object({ attached_pic: z.int().optional() }).optional(),
      duration: z.coerce.number().optional(),
      height: z.int().optional(),
      r_frame_rate: z.string().optional(),
      side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional(),
      tags: z.object({ rotate: z.coerce.number().optional() }).optional(),
      width: z.int().optional(),
    }),
  ),
});

export type MediaInfo = {
  /** ffprobe's `format_name`, split: `["mov", "mp4", …]`, `["matroska", "webm"]`, `["png_pipe"]`. */
  formats: string[];
  /** The ISO BMFF major brand; `qt` marks a QuickTime `.mov`. */
  brand: string | null;
  /**
   * The video stream's duration when the container records one (MP4, QuickTime), else the
   * file's. A phone clip's audio can start or end some milliseconds off its video; the clip's
   * length is the length of its picture.
   */
  durationMs: number | null;
  /** The first video stream that is not cover art; width and height as displayed (rotation applied). */
  video: { codec: string; fps: number | null; height: number; width: number } | null;
  hasAudio: boolean;
};

/** `"30000/1001"` → 29.97; `null` for ffprobe's `0/0` (unknown). */
export function frameRate(rate: string | undefined) {
  const [numerator, denominator] = (rate ?? "").split("/").map(Number);

  return numerator && denominator ? numerator / denominator : null;
}

/** Reads a file's container and streams with ffprobe; `null` when ffprobe cannot read it as media. */
export async function probe(path: string, signal?: AbortSignal): Promise<MediaInfo | null> {
  let stdout: string;

  try {
    ({ stdout } = await runTool(
      "ffprobe",
      ["-print_format", "json", "-show_format", "-show_streams", path],
      signal,
    ));
  } catch (error) {
    if (error instanceof Error && exitedNonzero(error)) {
      return null;
    }

    throw error;
  }

  const { format, streams } = probeOutputSchema.parse(JSON.parse(stdout));

  const video = streams.find(
    (stream) =>
      stream.codec_type === "video" &&
      stream.disposition?.attached_pic !== 1 &&
      stream.width &&
      stream.height,
  );

  const rotation =
    video?.side_data_list?.find((data) => data.rotation)?.rotation ?? video?.tags?.rotate ?? 0;

  const turned = Math.abs(rotation) % 180 === 90;
  const seconds = video?.duration ?? format.duration;

  return {
    brand: format.tags?.major_brand?.trim() ?? null,
    durationMs: seconds === undefined ? null : Math.round(seconds * 1000),
    formats: format.format_name.split(","),
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
    video:
      video?.width && video.height
        ? {
            codec: video.codec_name ?? "unknown",
            fps: frameRate(video.avg_frame_rate) ?? frameRate(video.r_frame_rate),
            height: turned ? video.width : video.height,
            width: turned ? video.height : video.width,
          }
        : null,
  };
}

export type VideoFile = {
  ext: string;
  mime: string;
  durationMs: number;
  fps: number | null;
  hasAudio: boolean;
  height: number;
  width: number;
};

function videoContainer(info: MediaInfo) {
  // ffprobe reads MP4 and QuickTime with one demuxer; the major brand `qt` marks QuickTime.
  if (info.formats.includes("mp4")) {
    return info.brand === "qt"
      ? { ext: "mov", mime: "video/quicktime" }
      : { ext: "mp4", mime: "video/mp4" };
  }

  // Matroska and WebM share a demuxer too; WebM allows only these video codecs.
  if (info.formats.includes("webm") && ["vp8", "vp9", "av1"].includes(info.video?.codec ?? "")) {
    return { ext: "webm", mime: "video/webm" };
  }

  return null;
}

/**
 * The upload rules: an MP4, QuickTime or WebM file with a video stream (`no_video` otherwise)
 * of at least 3 s (`too_short`). Longer than 8 s is accepted; the caller trims it.
 */
export function classifyVideo(
  info: MediaInfo | null,
): { file: VideoFile } | { reason: VideoRejection } {
  const container = info && videoContainer(info);

  if (!info?.video || !container || info.durationMs === null) {
    return { reason: "no_video" };
  }

  if (info.durationMs < MIN_CLIP_MS) {
    return { reason: "too_short" };
  }

  return {
    file: {
      ...container,
      durationMs: info.durationMs,
      fps: info.video.fps,
      hasAudio: info.hasAudio,
      height: info.video.height,
      width: info.video.width,
    },
  };
}

const imageFormats = [
  { ext: "png", format: "png_pipe", mime: "image/png" },
  { ext: "jpg", format: "jpeg_pipe", mime: "image/jpeg" },
  { ext: "webp", format: "webp_pipe", mime: "image/webp" },
] as const;

/** A PNG, JPEG or WebP still, by its content; `null` for anything else. */
export function classifyImage(info: MediaInfo | null) {
  const image = imageFormats.find((candidate) => info?.formats.includes(candidate.format));

  return image && info?.video
    ? { ext: image.ext, height: info.video.height, mime: image.mime, width: info.video.width }
    : null;
}
