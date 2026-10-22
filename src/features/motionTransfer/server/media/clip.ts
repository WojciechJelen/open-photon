import { type MediaInfo, videoContainer } from "../../../../shared/server/media/probe.ts";
import { MIN_CLIP_MS, type VideoRejection } from "../../contracts.ts";

type VideoFile = {
  ext: string;
  mime: string;
  durationMs: number;
  fps: number | null;
  hasAudio: boolean;
  height: number;
  width: number;
};

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
