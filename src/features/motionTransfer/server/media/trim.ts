import { z } from "zod";

import { MIN_CLIP_MS } from "../../contracts.ts";
import { exitedNonzero, frameRate, probe, runTool } from "./probe.ts";

/**
 * The shortest cut that counts as 3 s: 3 s less one frame, because whole frames cannot always
 * land on 3 s (89 frames at 30000/1001 fps last 2.97 s, 90 last 3.003 s).
 */
export function shortestCutMs(fps: number | null) {
  return MIN_CLIP_MS - (fps ? 1000 / fps : 0);
}

const cutPointSchema = z.object({
  format: z.object({ start_time: z.coerce.number().optional() }),
  packets: z.array(z.object({ flags: z.string(), pts_time: z.coerce.number() })).default([]),
  streams: z.array(
    z.object({
      avg_frame_rate: z.string(),
      codec_name: z.string(),
      has_b_frames: z.int().default(0),
    }),
  ),
});

/** The first video packet at or before `seconds` (a keyframe: ffprobe seeks to one), and the stream's reorder depth. */
async function cutPoint(input: string, seconds: number, signal?: AbortSignal) {
  const { stdout } = await runTool(
    "ffprobe",
    [
      "-select_streams",
      "v:0",
      "-read_intervals",
      // A millisecond of slack so a keyframe exactly at the cut is not skipped by rounding.
      `${seconds + 0.001}%+#1`,
      "-show_entries",
      "format=start_time:stream=codec_name,avg_frame_rate,has_b_frames:packet=pts_time,flags",
      "-print_format",
      "json",
      input,
    ],
    signal,
  );

  const { format, packets, streams } = cutPointSchema.parse(JSON.parse(stdout));
  const stream = streams[0];
  const packet = packets[0];
  const start = format.start_time ?? 0;

  const fps = frameRate(stream?.avg_frame_rate);

  return {
    codec: stream?.codec_name,
    fps,
    keyframe:
      packet?.flags.startsWith("K") === true &&
      Math.abs(packet.pts_time - start - seconds) <= 0.001,
    /** The exact rational (`"30000/1001"`) behind `fps`, for FFmpeg's `-r`. */
    rate: fps ? stream?.avg_frame_rate : undefined,
    reorderFrames: stream?.has_b_frames ?? 0,
  };
}

/**
 * Cuts `durationMs` from `startMs` of `input` into an MP4 at `output`, keeping the first video
 * and audio streams together so the passthrough audio stays in sync. A cut that starts on a
 * keyframe is a stream copy; any other cut, or a copy the MP4 muxer refuses or that does not
 * last `shortestCutMs` to `durationMs`, is re-encoded to H.264 and AAC. The re-encode lasts a
 * whole number of frames at most `durationMs` long, so the caller still checks the result's
 * length.
 */
export async function trimVideo(
  input: string,
  output: string,
  startMs: number,
  durationMs: number,
  signal?: AbortSignal,
): Promise<"copy" | "encode"> {
  const start = startMs / 1000;
  const point = await cutPoint(input, start, signal);

  // `-t` before `-i` stops reading every stream at the same input time, so the streams end
  // together even when the source's audio and video do not start together.
  const read = (seconds: number) => [
    "-ss",
    String(start),
    "-t",
    String(seconds),
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
  ];

  const mp4 = ["-movflags", "+faststart", "-f", "mp4", output];

  // The start of the file is a clean cut even when its first frame sits a little after zero.
  if ((startMs === 0 || point.keyframe) && point.fps) {
    // A copy ends on the first packet past the cut in decode order, and B-frame reordering puts
    // up to `has_b_frames` more frames after it; end that much earlier to stay within the length.
    const end = durationMs / 1000 - (point.reorderFrames + 0.5) / point.fps;

    try {
      await runTool(
        "ffmpeg",
        [
          ...read(end),
          "-c",
          "copy",
          // Safari plays HEVC in MP4 only under the `hvc1` tag.
          ...(point.codec === "hevc" ? ["-tag:v", "hvc1"] : []),
          ...mp4,
        ],
        signal,
      );

      const copied = await probe(output, signal);

      if (
        copied?.video &&
        copied.durationMs !== null &&
        copied.durationMs >= shortestCutMs(point.fps) &&
        copied.durationMs <= durationMs
      ) {
        return "copy";
      }
    } catch (error) {
      if (!(error instanceof Error && exitedNonzero(error))) {
        throw error;
      }
    }
  }

  // Every frame lasts its whole duration, so a plain `-t 8` of a 30000/1001 fps clip keeps the
  // 240 frames that start before 8 s and lasts 8.008 s. Constant-rate output capped at the frames
  // that fit makes the cut exactly `frames / fps` long.
  const frames = point.fps ? Math.floor((durationMs / 1000) * point.fps + 1e-6) : null;

  await runTool(
    "ffmpeg",
    [
      ...read(frames && point.fps ? frames / point.fps : durationMs / 1000),
      ...(frames && point.rate
        ? ["-fps_mode", "cfr", "-r", point.rate, "-frames:v", String(frames)]
        : []),
      // 4:2:0 needs even dimensions; pad an odd edge by one pixel rather than rescale the picture.
      "-vf",
      "pad=ceil(iw/2)*2:ceil(ih/2)*2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      ...mp4,
    ],
    signal,
  );

  return "encode";
}
