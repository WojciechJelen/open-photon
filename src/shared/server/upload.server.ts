import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import Busboy from "@fastify/busboy";
import type { ServerRequest } from "srvx";

import { incomingPath } from "./assets.ts";

export const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

/** A request the upload routes refuse; `handleUpload` turns it into `{ error, reason? }` JSON. */
export class UploadError extends Error {
  status: number;
  reason: string | undefined;
  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

type Upload = {
  bytes: number;
  /** The accepted text fields, by name. */
  fields: Map<string, string>;
  sha256: string;
  /** The received file, in the assets directory; `handleUpload` deletes it unless it was moved. */
  temporary: string;
};

/**
 * Streams the one file of a multipart request (in `fileField`, alongside only `fieldNames`) to a
 * temporary file, hashing it on the way. Over 128 MiB is a 413 before anything is written when
 * the request declares its length, and as soon as the limit is crossed otherwise.
 */
async function receiveUpload(
  request: ServerRequest,
  fileField: string,
  fieldNames: readonly string[],
): Promise<Upload> {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.startsWith("multipart/form-data;")) {
    throw new UploadError(415, "Use multipart/form-data");
  }

  const length = Number(request.headers.get("content-length") ?? 0);

  if (length > MAX_REQUEST_BYTES) {
    throw new UploadError(413, "Maximum file size is 128 MiB");
  }

  const body = request.runtime?.node?.req ?? request.body;

  if (!body) {
    throw new UploadError(400, "Missing upload body");
  }

  const temporary = await incomingPath();
  const abort = new AbortController();
  const onAbort = () => abort.abort(request.signal.reason);
  request.signal.addEventListener("abort", onAbort, { once: true });

  if (request.signal.aborted) {
    onAbort();
  }

  const hash = createHash("sha256");
  const fields = new Map<string, string>();
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
        fieldSize: 1024,
        fields: fieldNames.length,
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
      failure = new UploadError(400, "Too many form fields");
    });
    parser.on("field", (name, value) => {
      if (fieldNames.includes(name)) {
        fields.set(name, value);
      } else {
        failure = new UploadError(400, `Unexpected form field ${name}`);
      }
    });
    parser.on("file", (field, file) => {
      fileSeen = true;

      if (field !== fileField) {
        failure = new UploadError(400, `Upload the file in the ${fileField} field`);
        file.resume();

        return;
      }

      file.on("limit", () => {
        failure = new UploadError(413, "Maximum file size is 128 MiB");
      });

      const digest = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          hash.update(chunk);
          callback(null, chunk);
        },
      });

      saving = pipeline(
        file,
        digest,
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

    const chunks =
      body instanceof Readable ? body.iterator({ destroyOnReturn: false }) : readBody(body);

    await pipeline(
      Readable.from(chunks, { highWaterMark: 65_536, objectMode: false }),
      limit,
      parser,
      { signal: abort.signal },
    );
    await saving;

    if (failure) {
      throw failure;
    }

    if (!fileSeen || bytes === 0) {
      throw new UploadError(400, `Upload a nonempty file in the ${fileField} field`);
    }

    return { bytes, fields, sha256: hash.digest("hex"), temporary };
  } catch (error) {
    abort.abort(error);
    await saving;
    await rm(temporary, { force: true });

    throw error instanceof UploadError
      ? error
      : new UploadError(400, "Invalid or interrupted multipart upload");
  } finally {
    request.signal.removeEventListener("abort", onAbort);

    if (body instanceof Readable && !body.readableEnded) {
      body.resume();
    }
  }
}

/**
 * Receives the upload, hands it to `store` (which moves the file away or throws an
 * `UploadError`), and deletes the temporary file whatever happens. An `UploadError` becomes a
 * `{ error, reason? }` JSON response with its status.
 */
export async function handleUpload(
  request: ServerRequest,
  fileField: string,
  fieldNames: readonly string[],
  store: (upload: Upload) => Promise<Response>,
) {
  let temporary: string | undefined;

  try {
    const upload = await receiveUpload(request, fileField, fieldNames);
    temporary = upload.temporary;

    return await store(upload);
  } catch (error) {
    if (error instanceof UploadError) {
      return Response.json(
        { error: error.message, reason: error.reason },
        { status: error.status },
      );
    }

    throw error;
  } finally {
    if (temporary) {
      await rm(temporary, { force: true });
    }
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
