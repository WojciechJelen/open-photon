import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import Busboy from "@fastify/busboy";

import { mediaDirectory } from "./media.server.ts";

export const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

class UploadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function uploadMedia(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.startsWith("multipart/form-data;")) {
    return Response.json({ error: "Use multipart/form-data" }, { status: 415 });
  }

  const length = Number(request.headers.get("content-length") ?? 0);

  if (length > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Maximum file size is 128 MiB" }, { status: 413 });
  }

  if (!request.body) {
    return Response.json({ error: "Missing upload body" }, { status: 400 });
  }

  const directory = mediaDirectory();
  await mkdir(directory, { recursive: true });
  const filename = `${randomUUID()}.mp4`;
  const destination = resolve(directory, filename);
  const temporary = `${destination}.part`;
  const abort = new AbortController();
  const onAbort = () => abort.abort(request.signal.reason);
  request.signal.addEventListener("abort", onAbort, { once: true });

  if (request.signal.aborted) {
    onAbort();
  }

  let fileSeen = false;
  let bytes = 0;
  let failure: Error | undefined;
  let saving: Promise<void> = Promise.resolve();

  try {
    const parser = new Busboy({
      fileHwm: 65_536,
      headers: { "content-type": contentType },
      highWaterMark: 65_536,
      limits: {
        fields: 0,
        files: 1,
        fileSize: MAX_UPLOAD_BYTES,
        headerPairs: 32,
        headerSize: 8192,
      },
    });

    parser.on("filesLimit", () => {
      failure = new UploadError(400, "Upload exactly one file");
    });
    parser.on("fieldsLimit", () => {
      failure = new UploadError(400, "Only the file field is accepted");
    });
    parser.on("file", (field, file, originalName) => {
      fileSeen = true;

      if (field !== "file" || !originalName.toLowerCase().endsWith(".mp4")) {
        failure = new UploadError(400, "Use the file field with an MP4 filename");
        file.resume();

        return;
      }

      file.on("limit", () => {
        failure = new UploadError(413, "Maximum file size is 128 MiB");
      });

      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          callback(null, chunk);
        },
      });

      saving = pipeline(
        file,
        counter,
        createWriteStream(temporary, { flags: "wx", highWaterMark: 65_536 }),
        { signal: abort.signal },
      ).catch((error) => {
        failure = error instanceof Error ? error : new Error("Upload write failed");
      });
    });
    let received = 0;

    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        callback(
          received > MAX_REQUEST_BYTES
            ? new UploadError(413, "Maximum file size is 128 MiB")
            : null,
          chunk,
        );
      },
    });

    await pipeline(Readable.from(readBody(request.body)), limit, parser, {
      signal: abort.signal,
    });
    await saving;

    if (failure) {
      throw failure;
    }

    if (!fileSeen || bytes === 0) {
      throw new UploadError(400, "Upload a nonempty MP4 file");
    }

    await rename(temporary, destination);

    return Response.json({ bytes, filename, url: `/media/${filename}` }, { status: 201 });
  } catch (error) {
    abort.abort(error);
    await saving;
    await rm(temporary, { force: true });

    return Response.json(
      {
        error:
          error instanceof UploadError ? error.message : "Invalid or interrupted multipart upload",
      },
      { status: error instanceof UploadError ? error.status : 400 },
    );
  } finally {
    request.signal.removeEventListener("abort", onAbort);
  }
}

async function* readBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        return;
      }

      yield chunk.value;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
