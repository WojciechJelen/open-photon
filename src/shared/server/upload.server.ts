import { createHash } from "node:crypto";
import { close, open, write } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import Busboy from "@fastify/busboy";
import type { ServerRequest } from "srvx";

import { incomingPath } from "./assets.ts";

export const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;

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
 * Writes the file part to a new file and frees each chunk's memory as soon as it is on disk.
 *
 * Node's HTTP parser copies every socket read into a fresh Buffer that only garbage collection
 * frees, and V8 defers collecting such buffers until about 64 MiB of them are dead (its
 * external-memory soft limit). A 100 MiB upload therefore held tens of MiB of consumed chunks.
 * Detaching a chunk's ArrayBuffer (`transfer(0)`) frees it immediately, so the upload's memory
 * is bounded by the streams' high-water marks instead of by collection timing. Only buffers in
 * `owned` (the request's own body chunks) whose whole content this chunk is are detached: any
 * other view, such as the part before a multipart boundary, is left to garbage collection.
 */
class IncomingFile extends Writable {
  #fd = -1;
  /** Set while a write is on the thread pool; `_destroy` must not close the fd under it. */
  #writing = false;
  #closeAfterWrite: (() => void) | undefined;
  readonly #path: string;
  readonly #owned: WeakSet<ArrayBuffer>;
  readonly #digest: (chunk: Buffer) => void;

  constructor(path: string, owned: WeakSet<ArrayBuffer>, digest: (chunk: Buffer) => void) {
    super({ highWaterMark: 65_536 });
    this.#path = path;
    this.#owned = owned;
    this.#digest = digest;
  }

  override _construct(callback: (error?: Error | null) => void) {
    open(this.#path, "wx", (error, fd) => {
      if (!error) {
        this.#fd = fd;
      }

      callback(error);
    });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.#digest(chunk);
    this.#writing = true;

    const put = (offset: number) =>
      write(this.#fd, chunk, offset, chunk.length - offset, null, (error, written) => {
        if (!error && offset + written < chunk.length) {
          put(offset + written);

          return;
        }

        this.#writing = false;
        const { buffer } = chunk;

        if (
          !error &&
          buffer instanceof ArrayBuffer &&
          chunk.byteOffset === 0 &&
          chunk.byteLength === buffer.byteLength &&
          this.#owned.has(buffer) &&
          !buffer.detached
        ) {
          buffer.transfer(0);
        }

        callback(error);
        this.#closeAfterWrite?.();
      });

    put(0);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    const finish = () => {
      if (this.#fd < 0) {
        callback(error);

        return;
      }

      const fd = this.#fd;
      this.#fd = -1;
      close(fd, (closeError) => callback(error ?? closeError));
    };

    if (this.#writing) {
      this.#closeAfterWrite = finish;
    } else {
      finish();
    }
  }
}

/**
 * Streams the one file of a multipart request (in `fileField`, alongside only `fieldNames`) to a
 * temporary file, hashing it on the way. Over `maxBytes` (128 MiB unless the route sets less) is
 * a 413 before anything is written when the request declares its length, and as soon as the
 * limit is crossed otherwise.
 */
async function receiveUpload(
  request: ServerRequest,
  fileField: string,
  fieldNames: readonly string[],
  maxBytes: number,
): Promise<Upload> {
  const contentType = request.headers.get("content-type") ?? "";
  const tooLarge = `Maximum file size is ${maxBytes / (1024 * 1024)} MiB`;
  // Room for the multipart envelope and the text fields around the file.
  const maxRequestBytes = maxBytes + 64 * 1024;

  if (!contentType.startsWith("multipart/form-data;")) {
    throw new UploadError(415, "Use multipart/form-data");
  }

  const length = Number(request.headers.get("content-length") ?? 0);

  if (length > maxRequestBytes) {
    throw new UploadError(413, tooLarge);
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
  // Node's HTTP parser hands this request its own copy of every socket read; `IncomingFile`
  // frees those copies once written. A web-stream body's chunks may be views of shared memory.
  const owned = new WeakSet<ArrayBuffer>();
  const ownsChunks = body instanceof Readable;
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
        fileSize: maxBytes,
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
        failure = new UploadError(413, tooLarge);
      });

      saving = pipeline(
        file,
        new IncomingFile(temporary, owned, (chunk) => {
          bytes += chunk.length;
          hash.update(chunk);
        }),
        { signal: abort.signal },
      ).catch((error) => {
        failure = error instanceof Error ? error : new Error("Upload write failed");
      });
    });
    let received = 0;

    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;

        if (ownsChunks && chunk.buffer instanceof ArrayBuffer) {
          owned.add(chunk.buffer);
        }

        callback(received > maxRequestBytes ? new UploadError(413, tooLarge) : null, chunk);
      },
    });

    // The Node request pipes in flowing mode, which hands over each parser Buffer as is (a paused
    // `read()` merges queued chunks into a copy that is garbage twice over). Unlike a pipeline
    // from the request, a refused upload leaves the request open for its response.
    await (body instanceof Readable
      ? pipeline(body.pipe(limit), parser, { signal: abort.signal })
      : pipeline(
          Readable.from(readBody(body), { highWaterMark: 65_536, objectMode: false }),
          limit,
          parser,
          { signal: abort.signal },
        ));
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
 * Receives the upload (at most `maxBytes`, 128 MiB by default), hands it to `store` (which moves
 * the file away or throws an `UploadError`), and deletes the temporary file whatever happens. An
 * `UploadError` becomes a `{ error, reason? }` JSON response with its status.
 */
export async function handleUpload(
  request: ServerRequest,
  fileField: string,
  fieldNames: readonly string[],
  store: (upload: Upload) => Promise<Response>,
  maxBytes = MAX_UPLOAD_BYTES,
) {
  let temporary: string | undefined;

  try {
    const upload = await receiveUpload(request, fileField, fieldNames, maxBytes);
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
