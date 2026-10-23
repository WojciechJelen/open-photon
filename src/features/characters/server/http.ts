import type { ServerRequest } from "srvx";
import { z } from "zod";

import { readJsonBody } from "../../../shared/server/access.server.ts";
import { storeAsset } from "../../../shared/server/assets.ts";
import { classifyImage, probe } from "../../../shared/server/media/probe.ts";
import { handleUpload, UploadError } from "../../../shared/server/upload.server.ts";
import {
  type CharacterList,
  characterListQuerySchema,
  characterPatchSchema,
} from "../contracts.ts";
import {
  CharacterError,
  createFromUpload,
  getCharacter,
  listCharacters,
  renameCharacter,
  setFavorite,
} from "./repository.ts";

/**
 * `GET /api/characters`; the contract is documented on `characterListQuerySchema` (the access
 * guard answers 401 `access_required` without a session). The list is `listCharacters`'.
 */
export function listLibrary(request: Request) {
  const query = characterListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  if (!query.success) {
    return Response.json({ error: z.prettifyError(query.error) }, { status: 400 });
  }

  const { favorites, q, samples } = query.data;
  const list: CharacterList = {
    characters: listCharacters({ favorites, includeSamples: samples, query: q }),
  };

  return Response.json(list, { headers: { "Cache-Control": "private, no-store" } });
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

    const { character, created } = createFromUpload({
      assetId: asset.id,
      consentAt: new Date().toISOString(),
    });

    return Response.json(character, { status: created ? 201 : 200 });
  });
}

/**
 * `PATCH /api/characters/:id`; the contract is documented on `characterPatchSchema` (400 when the
 * body is not it, or is over 4 KiB). The title is set before the favorite, so a refused title
 * changes nothing.
 */
export async function patchCharacter(request: Request, id: string) {
  const body = await readJsonBody(request, characterPatchSchema, 4096);

  if (body.error !== undefined) {
    return Response.json({ error: body.error }, { status: 400 });
  }

  const { favorite, title } = body.data;

  try {
    let character = z.uuid().safeParse(id).success ? getCharacter(id) : null;

    if (!character) {
      throw new CharacterError(404, "Character not found.", "not_found");
    }

    if (title !== undefined) {
      character = renameCharacter(id, title);
    }

    if (favorite !== undefined) {
      character = setFavorite(id, favorite);
    }

    return Response.json(character);
  } catch (error) {
    if (error instanceof CharacterError) {
      return Response.json(
        { error: error.message, reason: error.reason },
        { status: error.status },
      );
    }

    throw error;
  }
}
