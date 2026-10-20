import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { findAsset } from "./assets.ts";
import { assetsDirectory } from "./paths.ts";

export function byteRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);

  if (!match || (!match[1] && !match[2]) || size === 0) {
    return null;
  }

  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;

  if (
    (first !== undefined && !Number.isSafeInteger(first)) ||
    (last !== undefined && !Number.isSafeInteger(last))
  ) {
    return null;
  }

  const start = first ?? Math.max(0, size - (last ?? 0));
  const end = first === undefined ? size - 1 : Math.min(last ?? size - 1, size - 1);

  return start >= size || start > end ? null : { end, start };
}

/**
 * `GET`/`HEAD /media/<asset id>.<ext>`: a stored asset's file, with single byte ranges.
 * `?download=1` asks the browser to save it, as `open-photon-<first 8 of the id>.<ext>`.
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

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
    "Content-Length": String(info.size),
    "Content-Type": asset.mime,
    "Last-Modified": info.mtime.toUTCString(),
  });

  if (new URL(request.url).searchParams.get("download") === "1") {
    headers.set(
      "Content-Disposition",
      `attachment; filename="open-photon-${asset.id.slice(0, 8)}.${match?.[2]}"`,
    );
  }

  const rangeHeader = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const honorRange = rangeHeader && (!ifRange || ifRange === info.mtime.toUTCString());
  const range = honorRange ? byteRange(rangeHeader, info.size) : undefined;

  if (range === null) {
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
