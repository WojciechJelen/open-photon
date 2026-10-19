import { z } from "zod";

import { exitedNonzero, frameRate, probe, runTool } from "./probe.ts";

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

  return {
    codec: stream?.codec_name,
    fps: frameRate(stream?.avg_frame_rate),
    keyframe:
      packet?.flags.startsWith("K") === true &&
      Math.abs(packet.pts_time - start - seconds) <= 0.001,
    reorderFrames: stream?.has_b_frames ?? 0,
  };
}

/**
 * Cuts `durationMs` from `startMs` of `input` into an MP4 at `output`, keeping the first video
 * and audio streams together so the passthrough audio stays in sync. A cut that starts on a
 * keyframe is a stream copy; any other cut, or a copy the MP4 muxer refuses or that runs past
 * `durationMs`, is re-encoded to H.264 and AAC.
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

      if (copied?.video && copied.durationMs !== null && copied.durationMs <= durationMs) {
        return "copy";
      }
    } catch (error) {
      if (!(error instanceof Error && exitedNonzero(error))) {
        throw error;
      }
    }
  }

  await runTool(
    "ffmpeg",
    [
      ...read(durationMs / 1000),
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
