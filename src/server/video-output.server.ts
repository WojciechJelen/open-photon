import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { Output } from "@comfyorg/sdk";

import { videoOutputSchema } from "../lib/contracts.ts";
import { hashFile } from "./assets.ts";
import { mediaDirectory } from "./media.server.ts";
import { probe, runTool } from "./media/probe.ts";

export async function saveVideoOutput(id: string, output: Output, signal?: AbortSignal) {
  const directory = mediaDirectory();
  await mkdir(directory, { recursive: true });

  const filename = `${id}.mp4`,
    posterFilename = `${id}.jpg`;

  const temporary = resolve(directory, `${id}.${randomUUID()}.part.mp4`);
  const posterTemporary = `${temporary}.jpg`;

  try {
    await output.toFile(temporary, { signal, timeoutMs: 180_000 });
    const info = await stat(temporary);

    if (info.size === 0 || (output.sizeBytes > 0 && output.sizeBytes !== info.size)) {
      throw new Error("Downloaded video size does not match the provider output");
    }

    const metadata = await probe(temporary, signal);

    if (!metadata?.video || !metadata.durationMs) {
      throw new Error("The output has no decodable video stream");
    }

    const sha256 = await hashFile(temporary, signal);

    await runTool(
      "ffmpeg",
      ["-i", temporary, "-frames:v", "1", "-vf", "scale=640:-2", posterTemporary],
      signal,
    );
    signal?.throwIfAborted();
    await rename(posterTemporary, resolve(directory, posterFilename));
    await rename(temporary, resolve(directory, filename));

    return videoOutputSchema.parse({
      assetId: output.id,
      bytes: info.size,
      durationSeconds: metadata.durationMs / 1000,
      filename,
      height: metadata.video.height,
      posterFilename,
      sha256,
      width: metadata.video.width,
    });
  } finally {
    await rm(temporary, { force: true });
    await rm(posterTemporary, { force: true });
  }
}
