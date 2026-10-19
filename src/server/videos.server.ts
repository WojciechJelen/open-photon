import type { ServerRequest } from "srvx";

import { assetSchema, type VideoRejection } from "../lib/contracts.ts";
import { storeAsset } from "./assets.ts";
import { classifyVideo, probe } from "./media/probe.ts";
import { handleUpload, UploadError } from "./upload.server.ts";

const rejections: Record<VideoRejection, string> = {
  no_video: "This file has no video we can read. Upload an MP4, MOV or WebM clip.",
};

/** `POST /api/uploads`; the contract is documented in `src/lib/contracts.ts`. */
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

    return Response.json(assetSchema.parse(asset), { status: created ? 201 : 200 });
  });
}
