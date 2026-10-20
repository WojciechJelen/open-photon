import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { findAsset } from "./assets.ts";
import { assetsDirectory } from "./paths.ts";
import { isPublicAsset } from "./public-access.ts";

/**
 * A `Range` header against a file of `size` bytes, one range only: the inclusive span to send,
 * `"unsatisfiable"` (416) when it starts past the end or asks for an empty suffix, or `null` for
 * a header to ignore — malformed, several ranges, or last before first — which serves the whole
 * file, as RFC 9110 §14.2 allows.
 */
export function byteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);

  if (!match || (!match[1] && !match[2])) {
    return null;
  }

  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;

  if (
    (first !== undefined && !Number.isSafeInteger(first)) ||
    (last !== undefined && !Number.isSafeInteger(last)) ||
    (first !== undefined && last !== undefined && last < first)
  ) {
    return null;
  }

  if (first === undefined) {
    // A suffix: the last `last` bytes.
    return last === 0 || size === 0
      ? "unsatisfiable"
      : { end: size - 1, start: Math.max(0, size - (last ?? 0)) };
  }

  return first >= size
    ? "unsatisfiable"
    : { end: Math.min(last ?? size - 1, size - 1), start: first };
}

/**
 * `GET`/`HEAD /media/<asset id>.<ext>`: a stored asset's file, found by its id in the `assets`
 * table (the request never names a path), with single byte ranges. Assets never change, so the
 * answer is cacheable for a year (`immutable`) and its `ETag` is the file's SHA-256; a matching
 * `If-None-Match` gets 304. Only what anyone may see (samples and what a share page shows,
 * `isPublicAsset`) may sit in shared caches (`public`); everything else is behind the access code
 * (`private`). `?download=1` asks the browser to save
 * it, as `open-photon-<first 8 of the id>.<ext>`.
 */
export async function serveMedia(request: Request, filename: string) {
  const match = /^([0-9a-f-]{36})\.([a-z0-9]+)$/.exec(filename);
  const asset = match?.[1] ? findAsset(match[1]) : null;

  if (!asset || !asset.path.endsWith(`.${match?.[2]}`)) {
    return new Response("Media not found", { status: 404 });
  }

  const path = resolve(assetsDirectory(), asset.path);
  const info = await stat(path).catch(() => null);

  if (!info?.isFile()) {
    return new Response("Media not found", { status: 404 });
  }

  const etag = `"${asset.sha256}"`;
  const lastModified = info.mtime.toUTCString();

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": `${isPublicAsset(asset.id) ? "public" : "private"}, max-age=31536000, immutable`,
    ETag: etag,
    "Last-Modified": lastModified,
  });

  // Weak comparison (RFC 9110 §13.1.2): `W/"…"` names the same file, `*` any.
  const ifNoneMatch = request.headers
    .get("if-none-match")
    ?.split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""));

  if (ifNoneMatch?.some((tag) => tag === "*" || tag === etag)) {
    return new Response(null, { headers, status: 304 });
  }

  headers.set("Content-Length", String(info.size));
  headers.set("Content-Type", asset.mime);

  if (new URL(request.url).searchParams.get("download") === "1") {
    headers.set(
      "Content-Disposition",
      `attachment; filename="open-photon-${asset.id.slice(0, 8)}.${match?.[2]}"`,
    );
  }

  // `If-Range` keeps a resumed download on the same bytes: a range only while it still names
  // this file, by its ETag or its date.
  const rangeHeader = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const honorRange = rangeHeader && (!ifRange || ifRange === etag || ifRange === lastModified);
  const range = honorRange ? byteRange(rangeHeader, info.size) : null;

  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${info.size}`);
    headers.set("Content-Length", "0");

    return new Response(null, { headers, status: 416 });
  }

  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
  }

  const file =
    request.method === "HEAD"
      ? null
      : createReadStream(
          path,
          range ? { ...range, signal: request.signal } : { signal: request.signal },
        );

  const iterator = file?.[Symbol.asyncIterator]();
  let stopped = false;

  const body = iterator
    ? new ReadableStream<Uint8Array>({
        async cancel() {
          stopped = true;
          file?.destroy();
          await iterator.return?.();
        },
        async pull(controller) {
          try {
            const chunk = await iterator.next();

            if (stopped) {
              return;
            }

            if (chunk.done) {
              stopped = true;
              controller.close();

              return;
            }

            if (!(chunk.value instanceof Uint8Array)) {
              throw new TypeError("Expected file bytes");
            }

            controller.enqueue(new Uint8Array(chunk.value));
          } catch (error) {
            if (!stopped) {
              controller.error(error);
            }
          }
        },
      })
    : null;

  return new Response(body, { headers, status: range ? 206 : 200 });
}
