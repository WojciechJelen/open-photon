import type { ServerRequest } from "srvx";

import { storeAsset } from "../../../shared/server/assets.ts";
import { classifyImage, probe } from "../../../shared/server/media/probe.ts";
import { handleUpload, UploadError } from "../../../shared/server/upload.server.ts";
import { createFromUpload } from "./repository.ts";

/** `POST /api/characters`; the contract is documented on `characterSchema`. */
export function uploadCharacter(request: ServerRequest) {
  return handleUpload(request, "image", ["consent"], async (upload) => {
    if (upload.fields.get("consent") !== "true") {
      throw new UploadError(
        422,
        "Confirm that you may use this person's likeness.",
        "consent_required",
      );
    }

    const image = classifyImage(await probe(upload.temporary, request.signal));

    if (!image) {
      throw new UploadError(422, "Upload a PNG, JPEG or WebP image.", "not_image");
    }

    const { asset } = await storeAsset(upload.temporary, {
      bytes: upload.bytes,
      duration_ms: null,
      ext: image.ext,
      fps: null,
      has_audio: null,
      height: image.height,
      kind: "image",
      mime: image.mime,
      role: "upload",
      sha256: upload.sha256,
      source_asset_id: null,
      width: image.width,
    });

    const { character, created } = createFromUpload({
      assetId: asset.id,
      consentAt: new Date().toISOString(),
    });

    return Response.json(character, { status: created ? 201 : 200 });
  });
}
