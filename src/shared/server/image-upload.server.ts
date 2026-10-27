import type { ServerRequest } from "srvx";

import { assetSchema } from "../contracts.ts";
import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_MAX_SIDE } from "../image-upload.ts";
import { storeAsset } from "./assets.ts";
import { classifyImage, probe } from "./media/probe.ts";
import { handleUpload, UploadError } from "./upload.server.ts";

/**
 * Stores a received upload as an image asset (`kind: "image"`, `role: "upload"`), content
 * addressed, when its content is a PNG, JPEG or WebP (`classifyImage`, never the file's name or
 * declared type); else a 422 `not_image`. `created` is false when the same bytes were stored
 * before (the stored asset then).
 */
export async function storeUploadedImage(
  upload: { bytes: number; sha256: string; temporary: string },
  signal: AbortSignal,
  maxSide = Number.POSITIVE_INFINITY,
) {
  const image = classifyImage(await probe(upload.temporary, signal));

  if (!image) {
    throw new UploadError(422, "Upload a PNG, JPEG or WebP image.", "not_image");
  }

  if (image.width > maxSide || image.height > maxSide) {
    throw new UploadError(
      422,
      `Upload an image at most ${maxSide} pixels wide and high (this one is ${image.width}×${image.height}).`,
      "image_too_large",
    );
  }

  return storeAsset(upload.temporary, {
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
}

/**
 * `POST /api/image-uploads`: one image in the multipart field `image`, no other field. A session
 * is needed (the access guard: 401 `access_required`) and the route takes an upload token first
 * (`uploadRefusal`: 429 `rate_limited`). The file must be a PNG, JPEG or WebP by its content
 * (else 422 `not_image`), at most `IMAGE_UPLOAD_MAX_BYTES` (else 413) and
 * `IMAGE_UPLOAD_MAX_SIDE` pixels on each side (else 422 `image_too_large`). It is stored once by
 * content as an asset of kind `image`, role `upload`: 201 with the asset (`assetSchema`), 200 with
 * the same asset when those bytes are stored already. Any subject (a product, a scene, an
 * animation source); a person's photo that a feature renders as a character goes through
 * `POST /api/characters` with the uploader's likeness consent instead.
 */
export function uploadImage(request: ServerRequest) {
  return handleUpload(
    request,
    "image",
    [],
    async (upload) => {
      const { asset, created } = await storeUploadedImage(
        upload,
        request.signal,
        IMAGE_UPLOAD_MAX_SIDE,
      );

      return Response.json(assetSchema.parse(asset), { status: created ? 201 : 200 });
    },
    IMAGE_UPLOAD_MAX_BYTES,
  );
}
