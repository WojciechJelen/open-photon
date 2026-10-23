import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  findAsset,
  findBySha256,
  hashFile,
  incomingPath,
  type StoredAsset,
  storeAsset,
} from "../../../../shared/server/assets.ts";
import { probe, runTool } from "../../../../shared/server/media/probe.ts";
import { assetsDirectory } from "../../../../shared/server/paths.ts";
import type { Recipe } from "../recipe.ts";

/** The name of the side-by-side clip a done Motion Transfer generation carries beside `video`. */
export const COMPARE_OUTPUT = "compare";

// The frame the side-by-side fills: 9:16, the shape vertical feeds play full screen.
const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1920;

/** `value` rounded to the nearest even number of pixels, which 4:2:0 chroma needs. */
function even(value: number) {
  return Math.max(2, 2 * Math.round(value / 2));
}

/** A stored video's file and the size and timing the stitch reads from its row. */
function videoOf(asset: StoredAsset | null, what: string) {
  const { duration_ms: durationMs, fps, height, width } = asset ?? {};

  if (!asset || asset.kind !== "video" || !durationMs || !fps || !height || !width) {
    throw new Error(`The ${what} is not a stored video with a size, a length and a frame rate`);
  }

  return { durationMs, fps, height, id: asset.id, path: resolve(assetsDirectory(), asset.path), width };
}

/**
 * Stitches a done Motion Transfer take into one vertical MP4 and stores it (role `final`, cut from
 * the result): the driving clip (`recipe.inputs.driving_video_sha256`) on the left and the result
 * (`outputs.video`) on the right, both at the result's height, scaled together to 1080 wide and
 * centred on a black 1080×1920 frame. Wan renders frame N of the driving clip as frame N of the
 * result at the clip's rate, so both are timed by frame number at the result's rate; the clip lasts
 * as long as the result (a shorter driving clip holds its last frame) and carries the result's
 * audio as it is. H.264 High, `yuv420p`, `+faststart`: it plays in Chrome, Safari and iOS. Returns
 * the stored asset by output name (`COMPARE_OUTPUT`); throws when a file is missing or FFmpeg
 * fails.
 */
export async function stitchCompare(recipe: Recipe, outputs: Readonly<Record<string, string>>) {
  const result = videoOf(findAsset(outputs.video ?? ""), "result");
  const source = videoOf(findBySha256(recipe.inputs.driving_video_sha256), "driving clip");

  const sourceWidth = even((source.width * result.height) / source.height);
  const scale = Math.min(FRAME_WIDTH / (sourceWidth + result.width), FRAME_HEIGHT / result.height);
  const width = Math.min(FRAME_WIDTH, even((sourceWidth + result.width) * scale));
  const height = Math.min(FRAME_HEIGHT, even(result.height * scale));
  // Frame N of either input at N / fps, on one time base, so the two frames of a pair match.
  const byFrame = `settb=AVTB,setpts=N/(${result.fps}*TB)`;

  const graph = [
    `[0:v]${byFrame},scale=${sourceWidth}:${result.height},setsar=1[source]`,
    `[1:v]${byFrame},setsar=1[result]`,
    `[source][result]hstack=inputs=2,scale=${width}:${height},` +
      `pad=${FRAME_WIDTH}:${FRAME_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p[video]`,
  ].join(";");

  const file = await incomingPath();

  try {
    await runTool("ffmpeg", [
      "-i",
      source.path,
      "-i",
      result.path,
      "-filter_complex",
      graph,
      "-map",
      "[video]",
      "-map",
      "1:a:0?",
      "-t",
      String(result.durationMs / 1000),
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      file,
    ]);

    const info = await probe(file);

    if (!info?.video || info.durationMs === null) {
      throw new Error("FFmpeg wrote a side-by-side clip ffprobe cannot read");
    }

    const stored = await storeAsset(file, {
      bytes: (await stat(file)).size,
      duration_ms: info.durationMs,
      ext: "mp4",
      fps: info.video.fps,
      has_audio: info.hasAudio,
      height: info.video.height,
      kind: "video",
      mime: "video/mp4",
      role: "final",
      sha256: await hashFile(file),
      source_asset_id: result.id,
      width: info.video.width,
    });

    return { [COMPARE_OUTPUT]: stored.asset.id };
  } finally {
    await rm(file, { force: true });
  }
}
