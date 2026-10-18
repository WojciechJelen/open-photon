import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { NodeRequest, sendNodeResponse } from "srvx/node";

import { MAX_UPLOAD_BYTES, uploadMedia } from "../src/server/upload.server.ts";

const directory = mkdtempSync(join(tmpdir(), "comfy-http-upload-"));

process.env.MEDIA_DIRECTORY = directory;

const server = createServer(async (req, res) => {
  const response = await uploadMedia(new NodeRequest({ req, res }));
  await sendNodeResponse(res, response);
});

server.listen(0, "127.0.0.1");

await once(server, "listening");

const address = server.address();

assert.ok(address && typeof address === "object");

const url = `http://127.0.0.1:${address.port}/api/uploads`;

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { force: true, recursive: true });
});

function multipart(bytes: number) {
  const encoder = new TextEncoder();
  let remaining = bytes;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          '--upload\r\nContent-Disposition: form-data; name="file"; filename="test.mp4"\r\nContent-Type: video/mp4\r\n\r\n',
        ),
      );
    },
    pull(controller) {
      if (remaining > 0) {
        const size = Math.min(65_536, remaining);
        remaining -= size;
        controller.enqueue(new Uint8Array(size));
      } else {
        controller.enqueue(encoder.encode("\r\n--upload--\r\n"));
        controller.close();
      }
    },
  });
}

async function upload(bytes: number) {
  const options = {
    body: multipart(bytes),
    duplex: "half",
    headers: { "Content-Type": "multipart/form-data; boundary=upload" },
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  };

  return fetch(url, options);
}

test("the Node HTTP adapter streams uploads and reports the saved byte count", async () => {
  const response = await upload(1024 * 1024);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.bytes, 1024 * 1024);
  assert.ok(readdirSync(directory).includes(result.filename));
});

test("a chunked oversized HTTP upload returns 413 and removes its partial file", async () => {
  const before = readdirSync(directory);
  const response = await upload(MAX_UPLOAD_BYTES + 1024 * 1024);
  assert.equal(response.status, 413);
  await response.arrayBuffer();
  assert.deepEqual(readdirSync(directory), before);
});

test("disconnecting during a Node HTTP upload removes the partial file", async () => {
  const before = readdirSync(directory);
  const abort = new AbortController();

  const options = {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            '--upload\r\nContent-Disposition: form-data; name="file"; filename="test.mp4"\r\n\r\npartial',
          ),
        );
      },
    }),
    duplex: "half",
    headers: { "Content-Type": "multipart/form-data; boundary=upload" },
    method: "POST",
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
  };

  const rejected = assert.rejects(fetch(url, options));

  try {
    for (
      let i = 0;
      i < 100 && !readdirSync(directory).some((name) => name.endsWith(".part"));
      i++
    ) {
      await delay(10);
    }

    assert.ok(readdirSync(directory).some((name) => name.endsWith(".part")));
  } finally {
    abort.abort();
    await rejected;
  }

  for (let i = 0; i < 100 && readdirSync(directory).some((name) => name.endsWith(".part")); i++) {
    await delay(10);
  }

  assert.deepEqual(readdirSync(directory), before);
});
