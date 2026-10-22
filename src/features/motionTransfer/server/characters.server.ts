import { randomUUID } from "node:crypto";

import type { ServerRequest } from "srvx";
import { z } from "zod";

import { storeAsset } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";
import { classifyImage, probe } from "../../../shared/server/media/probe.ts";
import { handleUpload, UploadError } from "../../../shared/server/upload.server.ts";
import { characterSchema } from "../contracts.ts";

const storedCharacterSchema = characterSchema.extend({
  is_sample: z.union([z.literal(0), z.literal(1)]).transform((value) => value === 1),
});

export function findCharacter(id: string) {
  const row = database.prepare("SELECT * FROM characters WHERE id = ?").get(id);

  return row ? storedCharacterSchema.parse(row) : null;
}

export function listSampleCharacters() {
  return database
    .prepare("SELECT * FROM characters WHERE is_sample = 1 ORDER BY title")
    .all()
    .map((row) => storedCharacterSchema.parse(row));
}

/** `POST /api/characters`; the contract is documented on `characterSchema`. */
export function uploadCharacter(request: ServerRequest) {
  return handleUpload(request, "image", ["consent"], async (upload) => {
    if (upload.fields.get("consent") !== "true") {
      throw new UploadError(
        422,
        "Confirm that you may use this person's likeness.",
        "consent_required",
      );
    }

    const image = classifyImage(await probe(upload.temporary, request.signal));

    if (!image) {
      throw new UploadError(422, "Upload a PNG, JPEG or WebP image.", "not_image");
    }

    const { asset } = await storeAsset(upload.temporary, {
      bytes: upload.bytes,
      duration_ms: null,
      ext: image.ext,
      fps: null,
      has_audio: null,
      height: image.height,
      kind: "image",
      mime: image.mime,
      role: "upload",
      sha256: upload.sha256,
      source_asset_id: null,
      width: image.width,
    });

    const now = new Date().toISOString();

    const result = database
      .prepare(
        `INSERT INTO characters (id, image_asset_id, origin, consent_at, created_at)
VALUES (?, ?, 'upload', ?, ?)
ON CONFLICT (image_asset_id) WHERE origin = 'upload' DO NOTHING`,
      )
      .run(randomUUID(), asset.id, now, now);

    const character = storedCharacterSchema.parse(
      database
        .prepare("SELECT * FROM characters WHERE image_asset_id = ? AND origin = 'upload'")
        .get(asset.id),
    );

    return Response.json(character, { status: result.changes === 1 ? 201 : 200 });
  });
}
