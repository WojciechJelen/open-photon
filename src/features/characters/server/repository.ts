import { randomUUID } from "node:crypto";
import type { SQLOutputValue } from "node:sqlite";

import { z } from "zod";

import { findAsset } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";
import { isSharedOutput, readOutputs } from "../../../shared/server/generation/generations.ts";
import { readGenerationProvenance } from "../../../shared/server/generation/provenance.ts";
import {
  type CharacterProvenance,
  characterSchema,
  type CharacterSummary,
  characterSummarySchema,
  characterTitleSchema,
} from "../contracts.ts";

// The characters feature's repository. With the sample seeder (`seed.ts`) and the access
// declaration (`public-access.ts`), the only code that touches the `characters` table
// (`002-characters.sql`, `characters/001-library.sql`); other features use it through `api.ts`,
// which documents the ownership policy (one workspace library per installation).

/** A refused library operation, with the HTTP status and `reason` an endpoint answers with. */
export class CharacterError extends Error {
  status: 404 | 409 | 422;
  reason: string;
  constructor(status: 404 | 409 | 422, message: string, reason: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

const storedCharacterSchema = characterSchema.extend({
  favorite_at: z.iso.datetime().nullable(),
  is_sample: z.union([z.literal(0), z.literal(1)]).transform((value) => value === 1),
  provenance: z
    .string()
    .nullable()
    .transform((text) => (text === null ? null : JSON.parse(text))),
  updated_at: z.iso.datetime().nullable(),
});

/** The row with its image; `null` when the image is not stored (a database once without FKs). */
function summarize(row: Record<string, SQLOutputValue> | undefined): CharacterSummary | null {
  if (row === undefined) {
    return null;
  }

  const character = storedCharacterSchema.parse(row);
  const image = findAsset(character.image_asset_id);

  return image ? characterSummarySchema.parse({ ...character, image }) : null;
}

/** A character that must exist, as it is stored now. */
function readStored(id: string) {
  const character = getCharacter(id);

  if (!character) {
    throw new CharacterError(404, "Character not found.", "not_found");
  }

  return character;
}

/** The character `id` with its image; `null` for an unknown id or one whose image is not stored. */
export function getCharacter(id: string) {
  return summarize(database.prepare("SELECT * FROM characters WHERE id = ?").get(id));
}

/**
 * The workspace library, most recent first (`created_at`, then `id`, both descending): every
 * character that is not a sample and, with `includeSamples`, the samples too. `favorites` keeps
 * only the favorites; `query` (case-insensitive) only the characters whose title or prompt
 * contains it. Characters whose image is not stored are left out.
 */
export function listCharacters({
  favorites = false,
  includeSamples,
  query = "",
}: {
  favorites?: boolean;
  includeSamples: boolean;
  query?: string;
}) {
  const needle = query.toLocaleLowerCase();

  return database
    .prepare(
      `SELECT * FROM characters WHERE (is_sample = 0 OR ?) AND (favorite_at IS NOT NULL OR NOT ?)
      ORDER BY created_at DESC, id DESC`,
    )
    .all(Number(includeSamples), Number(favorites))
    .filter(
      ({ prompt, title }) =>
        needle === "" ||
        [title, prompt].some(
          (text) => typeof text === "string" && text.toLocaleLowerCase().includes(needle),
        ),
    )
    .flatMap((row) => summarize(row) ?? []);
}

/** The sample characters (the picker's), by title. */
export function listSampleCharacters() {
  return database
    .prepare("SELECT * FROM characters WHERE is_sample = 1 ORDER BY title")
    .all()
    .flatMap((row) => summarize(row) ?? []);
}

/**
 * A character as a page may show it to a visitor: `null` without a character, or when the
 * visitor has no session (`signedIn`) and the character is neither a sample nor saved from an
 * output a shared generation lists (`isSharedOutput`). An uploaded likeness needs a session.
 */
export function visibleCharacter(character: CharacterSummary | null, signedIn: boolean) {
  if (!character || signedIn || character.is_sample) {
    return character;
  }

  const image = findAsset(character.image_asset_id);

  return image && isSharedOutput(image) ? character : null;
}

/** The optional title of a new character, checked like a rename. */
function parseTitle(title: string | undefined) {
  if (title === undefined) {
    return null;
  }

  const parsed = characterTitleSchema.safeParse(title);

  if (!parsed.success) {
    throw new CharacterError(422, "A title is 1–80 characters.", "invalid_title");
  }

  return parsed.data;
}

/**
 * Adds an uploaded image to the library: the stored image asset `assetId`, with the uploader's
 * likeness consent given at `consentAt` (an upload exists only with it), and an optional `title`.
 * One character per image: for an image uploaded before, the stored character comes back as it
 * is (`created: false`). Refused: an asset that is not a stored image (422 `not_image`).
 */
export function createFromUpload({
  assetId,
  consentAt,
  title,
}: {
  assetId: string;
  consentAt: string;
  title?: string;
}) {
  if (findAsset(assetId)?.kind !== "image") {
    throw new CharacterError(422, "Upload a PNG, JPEG or WebP image.", "not_image");
  }

  const consent = z.iso.datetime().parse(consentAt);
  const now = new Date().toISOString();

  const result = database
    .prepare(
      `INSERT INTO characters (id, title, image_asset_id, origin, consent_at, created_at)
      VALUES (?, ?, ?, 'upload', ?, ?)
      ON CONFLICT (image_asset_id) WHERE origin = 'upload' DO NOTHING`,
    )
    .run(randomUUID(), parseTitle(title), assetId, consent, now);

  return {
    character: readStoredBy("image_asset_id = ? AND origin = 'upload'", assetId),
    created: result.changes === 1,
  };
}

/**
 * Saves a generation's image to the library, as the user's explicit action after seeing it: the
 * generation `generationId` must be `done` (409 `not_done`, 404 `not_found` for none) with an
 * image output named `outputName` (422 `no_output`, `not_image`). The character (`origin =
 * 'generated'`) takes that output's asset as its image, and its `prompt` and `provenance`
 * (workflow, model pins) from the generation's stored recipe (`readGenerationProvenance`), never
 * from the caller. Idempotent on the generation: once it is saved, saving it again returns that
 * character (`created: false`) before anything else is checked, whatever `outputName` and `title`
 * say then; two first saves at once insert one row (`characters_generation`). A rerun or retry is
 * another generation, so another character.
 */
export function createFromGeneration({
  generationId,
  outputName,
  title,
}: {
  generationId: string;
  outputName: string;
  title?: string;
}) {
  const saved = summarize(
    database
      .prepare("SELECT * FROM characters WHERE generation_id = ? AND origin = 'generated'")
      .get(generationId),
  );

  if (saved) {
    return { character: saved, created: false };
  }

  const provenance = readGenerationProvenance(generationId);

  if (!provenance) {
    throw new CharacterError(404, "Generation not found.", "not_found");
  }

  if (provenance.status !== "done") {
    throw new CharacterError(
      409,
      `Only a finished generation can be saved; this one is ${provenance.status}.`,
      "not_done",
    );
  }

  const output = readOutputs(generationId).find(({ name }) => name === outputName);

  if (!output) {
    throw new CharacterError(422, `This generation has no output "${outputName}".`, "no_output");
  }

  if (output.media !== "image") {
    throw new CharacterError(422, `The output "${outputName}" is not an image.`, "not_image");
  }

  const stored: CharacterProvenance = { models: provenance.models, workflow: provenance.workflow };
  const now = new Date().toISOString();

  const result = database
    .prepare(
      `INSERT INTO characters (id, title, image_asset_id, origin, prompt, generation_id, provenance,
        created_at)
      VALUES (?, ?, ?, 'generated', ?, ?, ?, ?)
      ON CONFLICT (generation_id) WHERE origin = 'generated' DO NOTHING`,
    )
    .run(
      randomUUID(),
      parseTitle(title),
      output.asset.id,
      provenance.prompt,
      generationId,
      JSON.stringify(stored),
      now,
    );

  return {
    character: readStoredBy("generation_id = ? AND origin = 'generated'", generationId),
    created: result.changes === 1,
  };
}

/** The one character `where` names, which an insert just made sure of. */
function readStoredBy(where: string, value: string) {
  const character = summarize(
    database.prepare(`SELECT * FROM characters WHERE ${where}`).get(value),
  );

  if (!character) {
    throw new Error(`No character with an image matches ${where} for ${value}`);
  }

  return character;
}

/**
 * Renames a character of the library (`characterTitleSchema`: 422 `invalid_title` otherwise). A
 * sample keeps its manifest's title (409 `sample`); 404 `not_found` for an unknown id.
 */
export function renameCharacter(id: string, title: string) {
  const name = parseTitle(title);

  if (readStored(id).is_sample) {
    throw new CharacterError(409, "A sample character keeps its title.", "sample");
  }

  database
    .prepare("UPDATE characters SET title = ?, updated_at = ? WHERE id = ?")
    .run(name, new Date().toISOString(), id);

  return readStored(id);
}

/**
 * Marks a character a favorite (`favorite_at`, kept from the first time when it already is one) or
 * unmarks it. Samples can be favorites too; 404 `not_found` for an unknown id.
 */
export function setFavorite(id: string, favorite: boolean) {
  readStored(id);

  const now = new Date().toISOString();

  database
    .prepare(
      `UPDATE characters SET updated_at = ?,
        favorite_at = CASE WHEN ? THEN coalesce(favorite_at, ?) END
      WHERE id = ?`,
    )
    .run(now, Number(favorite), now, id);

  return readStored(id);
}
