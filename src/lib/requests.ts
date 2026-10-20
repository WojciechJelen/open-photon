import { z } from "zod";

import { type UploadedVideo, uploadedVideoSchema } from "./contracts.ts";

const bodySchema = z.json().nullable().catch(null);

type Body = z.infer<typeof bodySchema>;

const errorBodySchema = z.object({ error: z.string(), reason: z.string().optional() });

/** A refused request in words, with the API's `reason` code when it gave one. */
export type Refusal = { message: string; reason?: string };

/**
 * The refusal an API error response carries: `{ error, reason? }`, or a status-based fallback. A
 * 401 without a body of its own is `access_required`, which makes the UI ask for the code.
 */
function refusal(status: number, body: Body): Refusal {
  if (status === 413) {
    return { message: "This file is over 128 MiB.", reason: "too_large" };
  }

  const parsed = errorBodySchema.safeParse(body);

  if (parsed.success) {
    return { message: parsed.data.error, reason: parsed.data.reason };
  }

  return status === 401
    ? { message: "Enter an access code to do this.", reason: "access_required" }
    : { message: `The request failed (${status}). Try again.` };
}

/**
 * A `fetch` to the app's API: the JSON body of a 2xx answer parsed with `schema`, or the refusal
 * of any other answer (or of no answer at all).
 */
export async function callApi<T extends z.ZodType>(
  schema: T,
  url: string,
  init: RequestInit,
): Promise<{ data: z.output<T> } | { refusal: Refusal }> {
  const response = await fetch(url, init).catch(() => null);

  if (!response) {
    return { refusal: { message: "The request did not reach the server. Check the connection." } };
  }

  const body = bodySchema.parse(await response.json().catch(() => null));

  return response.ok ? { data: schema.parse(body) } : { refusal: refusal(response.status, body) };
}

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
