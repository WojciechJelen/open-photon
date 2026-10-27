import "../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { crc32, deflateSync } from "node:zlib";

import { isPublicRequest } from "../../app/server.ts";
import { assetSchema } from "../contracts.ts";
import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_MAX_SIDE, uploadImageFile } from "../image-upload.ts";
import { database } from "./db.server.ts";
import { uploadImage } from "./image-upload.server.ts";
import { assetsDirectory } from "./paths.ts";

function post(file: Blob, field = "image") {
  const form = new FormData();

  form.append(field, file, "upload.bin");

  return uploadImage(
    new Request("http://localhost/api/image-uploads", { body: form, method: "POST" }),
  );
}

function assetCount() {
  return Number(database.prepare("SELECT count(*) AS count FROM assets").get()?.count);
}

/** A grey 8-bit RGB PNG of `width` × `height` pixels. */
function png(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    const crc = Buffer.alloc(4);

    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));

    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);

  // Each row: filter byte 0, then grey RGB pixels.
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 128)]);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("an image is stored once by its content as an upload, 201 then 200 with the same asset", async () => {
  const bytes = readFileSync("fixtures/wan/reference.png");
  const first = await post(new Blob([bytes], { type: "application/octet-stream" }));
  const asset = assetSchema.parse(await first.json());

  assert.equal(first.status, 201);
  assert.deepEqual([asset.kind, asset.role, asset.mime], ["image", "upload", "image/png"]);
  assert.ok(asset.width && asset.height);

  const again = await post(new Blob([bytes]));

  assert.equal(again.status, 200);
  assert.equal(assetSchema.parse(await again.json()).id, asset.id);
});

test("a file that is not a PNG, JPEG or WebP, or too large, is refused and nothing is stored", async () => {
  const files = readdirSync(assetsDirectory());
  const assets = assetCount();

  // A video named like an image is still a video.
  const video = await post(new Blob([readFileSync("fixtures/x.mp4")], { type: "image/png" }));

  assert.equal(video.status, 422);
  assert.equal((await video.json()).reason, "not_image");

  const wide = await post(new Blob([png(IMAGE_UPLOAD_MAX_SIDE + 1, 1)]));

  assert.equal(wide.status, 422);
  assert.equal((await wide.json()).reason, "image_too_large");

  const oversized = await post(new Blob([png(1, 1), new Uint8Array(IMAGE_UPLOAD_MAX_BYTES)]));

  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /25 MiB/);

  const misplaced = await post(new Blob([readFileSync("fixtures/wan/reference.png")]), "file");

  assert.equal(misplaced.status, 400);
  assert.deepEqual(readdirSync(assetsDirectory()), files);
  assert.equal(assetCount(), assets);
});

test("the image upload needs a session", () => {
  assert.equal(isPublicRequest("POST", "/api/image-uploads"), false);
});

test("the client helper posts the file and answers the asset, or the refusal in words", async (t) => {
  // The browser's `fetch` of `/api/image-uploads`, answered by the route's handler.
  t.mock.method(globalThis, "fetch", (url: string, init: RequestInit) =>
    uploadImage(new Request(new URL(url, "http://localhost"), init)),
  );

  const stored = await uploadImageFile(
    new File([readFileSync("fixtures/wan/reference.png")], "reference.png"),
  );

  assert.ok("data" in stored && stored.data.kind === "image");

  const tooLarge = await uploadImageFile(
    new File([png(1, 1), new Uint8Array(IMAGE_UPLOAD_MAX_BYTES)], "large.png"),
  );

  assert.deepEqual(tooLarge, {
    refusal: { message: "This image is over 25 MiB.", reason: "too_large" },
  });

  const video = await uploadImageFile(new File([readFileSync("fixtures/x.mp4")], "clip.png"));

  assert.equal("refusal" in video && video.refusal.reason, "not_image");
});
