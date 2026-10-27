import { assetSchema } from "./contracts.ts";
import { callApi } from "./requests.ts";

/** The most bytes `POST /api/image-uploads` takes (25 MiB); a larger file is a 413. */
export const IMAGE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** The most pixels an uploaded image may have on each side; a larger one is `image_too_large`. */
export const IMAGE_UPLOAD_MAX_SIDE = 8192;

/** The image types a file picker offers for it (the server checks the content itself). */
export const IMAGE_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * `POST /api/image-uploads` (`uploadImage` in `server/image-upload.server.ts`): stores `file` as
 * an image asset (`role: "upload"`) and answers it (`assetSchema`), the stored one when the same
 * bytes were uploaded before; or the refusal (`not_image`, `image_too_large`, `too_large`,
 * `rate_limited`, `access_required`). For any subject; a person's photo to render as a character
 * goes through `POST /api/characters` with consent instead.
 */
export async function uploadImageFile(file: File, signal?: AbortSignal) {
  const form = new FormData();

  form.append("image", file);

  const answer = await callApi(assetSchema, "/api/image-uploads", {
    body: form,
    method: "POST",
    signal,
  });

  return "refusal" in answer && answer.refusal.reason === "too_large"
    ? { refusal: { message: "This image is over 25 MiB.", reason: "too_large" } }
    : answer;
}
