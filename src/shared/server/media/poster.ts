import { probe, runTool } from "./probe.ts";

/**
 * Writes the frame of `video` at 0.5 s to `poster` as a JPEG, or its first frame when the video
 * ends before then; resolves to the still's size. Throws when FFmpeg writes nothing ffprobe can
 * read.
 */
export async function cutPoster(video: string, poster: string) {
  const cut = ["-i", video, "-frames:v", "1", "-f", "mjpeg", poster];

  const seeked = await runTool("ffmpeg", ["-ss", "0.5", ...cut]).then(
    () => probe(poster),
    () => null,
  );

  const frame = seeked?.video ? seeked : await runTool("ffmpeg", cut).then(() => probe(poster));

  if (!frame?.video) {
    throw new Error("FFmpeg wrote a poster ffprobe cannot read");
  }

  return frame.video;
}
