import { type UploadedVideo, uploadedVideoSchema } from "#/features/genjutsu/contracts";
import { bodySchema, type Refusal, refusal } from "#/shared/requests";

/**
 * `POST /api/uploads` through `XMLHttpRequest`, the browser API that reports upload progress:
 * `onProgress` with the percent sent, `onSent` once the whole file is up and the server probes it.
 * `signal` cancels the upload.
 */
export function sendVideo(
  file: File,
  {
    onProgress,
    onSent,
    signal,
  }: { onProgress: (percent: number) => void; onSent: () => void; signal: AbortSignal },
) {
  // The executor form, not `Promise.withResolvers` (ES2024): the client targets ES2022 so older
  // phone browsers can upload.
  return new Promise<{ video: UploadedVideo } | { refusal: Refusal }>((resolve) => {
    const request = new XMLHttpRequest();
    const form = new FormData();

    form.append("file", file);
    request.responseType = "json";

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.floor((event.loaded / event.total) * 100));
      }
    });

    request.upload.addEventListener("load", onSent);

    request.addEventListener("load", () => {
      const body = bodySchema.parse(request.response);

      resolve(
        request.status === 200 || request.status === 201
          ? { video: uploadedVideoSchema.parse(body) }
          : { refusal: refusal(request.status, body) },
      );
    });

    request.addEventListener("error", () =>
      resolve({
        refusal: { message: "The upload did not reach the server. Check the connection." },
      }),
    );

    request.addEventListener("abort", () =>
      resolve({ refusal: { message: "The upload was cancelled." } }),
    );

    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.open("POST", "/api/uploads");
    request.send(form);
  });
}
