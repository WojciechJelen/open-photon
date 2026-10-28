// A storyboard's admission, edits and reads. Every render goes through the generation service:
// the scene split (`storyboard-scenes`, one `submitMany` item, stored `waiting` with the
// storyboard in one transaction) and each card's image (the shared image edit, `submitMany` with
// one item per card asked for). This module only records which generations make up a storyboard
// and what each card said when it was rendered; one card's new generation never touches another's.
import { randomInt } from "node:crypto";

import type { Session } from "../../../shared/server/access.server.ts";
import type { Provider } from "../../../shared/server/comfy-provider.ts";
import { database } from "../../../shared/server/db.server.ts";
import { workflows } from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import {
  findLatestAttempt,
  type Generation,
  snapshot,
} from "../../../shared/server/generation/generations.ts";
import { type Admit, submitMany } from "../../../shared/server/generation/service.ts";
import { transaction } from "../../../shared/server/migrate.ts";
import { getCharacter } from "../../characters/api.ts";
import { imageEditDefinition } from "../../imageEdit/api.ts";
import {
  CARD_COUNT,
  CARD_SIZE,
  compileCardPrompt,
  type CreateStoryboardInput,
  type GenerateCardsInput,
  parseScenes,
  type SaveStoryboardInput,
  SCENES_OUTPUT,
  type Storyboard,
  storyboardListSchema,
  storyboardSchema,
} from "../contracts.ts";
import { storyboardScenesDefinition } from "../workflows/scenes-definition.ts";
import {
  type CardGenerationRow,
  findCardGenerations,
  findCardRequest,
  findDescriptions,
  findStoryboard,
  findStoryboardByKey,
  insertCardGenerations,
  insertStoryboard,
  listStoryboards,
  saveStoryboard,
  type StoryboardRow,
} from "./repository.ts";

// How many storyboards `GET /api/storyboards` lists.
const LISTED = 50;

// Below 2^48, the largest range `randomInt` draws from, as the service's retries draw.
const SEED_RANGE = 2 ** 48 - 1;

type Submission = {
  admit?: Admit;
  provider?: Provider;
  requestKey: string;
  session: Session | null;
};

const accessRequired = () =>
  new GenerateError(401, "Enter an access code to do this.", "access_required");

/**
 * A generation followed through each failed or cancelled one's newest child (the shared retry or
 * re-run) to the latest attempt, and how many attempts that skipped.
 */
function currentGeneration(id: string): { attempt: number; row: Generation } {
  const current = findLatestAttempt(id);

  if (!current) {
    throw new Error(`Storyboard generation ${id} is not stored`);
  }

  return current;
}

/** The seed a generation renders with, as its own workflow reads its recipe (`seedOf`). */
function seedOf(row: Generation) {
  const definition = workflows.find(row);

  if (!definition) {
    return null;
  }

  const parsed = definition.recipeSchema.safeParse(row.recipe);

  return parsed.success ? definition.seedOf(parsed.data) : null;
}

/**
 * Where the storyboard's scenes stand, and the four scenes once the split gave them: written by
 * hand (`manual`), on their way, `ready`, or `failed` with what to tell the user.
 */
function scenesOf(storyboard: StoryboardRow) {
  if (!storyboard.scenes_generation_id) {
    return { generation: null, message: null, scenes: null, state: "manual" as const };
  }

  const { row } = currentGeneration(storyboard.scenes_generation_id);
  const generation = snapshot(row);

  if (row.status === "done") {
    const output = generation.outputs.find((item) => item.name === SCENES_OUTPUT);
    const scenes = output?.media === "text" ? parseScenes(output.text) : null;

    return scenes
      ? { generation, message: null, scenes, state: "ready" as const }
      : {
          generation,
          message:
            "The text model did not answer with four scenes. Write them yourself, or try the split again.",
          scenes: null,
          state: "failed" as const,
        };
  }

  if (row.status === "failed" || row.status === "cancelled" || row.status === "unknown") {
    return {
      generation,
      message: `The scenes could not be written: ${row.error_message ?? row.status}. Write them yourself${row.status === "unknown" ? "" : ", or try again"}.`,
      scenes: null,
      state: "failed" as const,
    };
  }

  return { generation, message: null, scenes: null, state: "writing" as const };
}

/** The storyboard's character as its answers show it; throws when it is not stored. */
function characterOf(storyboard: StoryboardRow) {
  const character = getCharacter(storyboard.character_id);

  if (!character) {
    throw new Error(`Storyboard ${storyboard.id} names no stored character`);
  }

  return {
    id: character.id,
    image: character.image,
    origin: character.origin,
    title: character.title,
  };
}

/** Each card's generations, oldest first, by position. */
function historyByCard(storyboardId: string) {
  const history = findCardGenerations(storyboardId);

  return Array.from({ length: CARD_COUNT }, (_, position) =>
    history.filter((row) => row.position === position),
  );
}

/**
 * A storyboard with every card (`storyboardSchema`): its description (saved, else the split's
 * scene, else blank) and its current generation; `null` for an id no storyboard has.
 */
export function readStoryboard(id: string): Storyboard | null {
  const storyboard = findStoryboard(id);

  if (!storyboard) {
    return null;
  }

  const { scenes, ...sceneState } = scenesOf(storyboard);
  const descriptions = findDescriptions(storyboard.id);

  const cards = historyByCard(storyboard.id).map((history, position) => {
    const latest = history.at(-1);
    const current = latest ? currentGeneration(latest.generation_id) : null;

    return {
      attempt: current?.attempt ?? 0,
      description: descriptions[position] ?? scenes?.[position] ?? "",
      generation: current ? snapshot(current.row) : null,
      history: history.length,
      position,
      seed: current ? seedOf(current.row) : null,
    };
  });

  return storyboardSchema.parse({
    cards,
    character: characterOf(storyboard),
    created_at: storyboard.created_at,
    id: storyboard.id,
    scenes: sceneState,
    seed: storyboard.seed,
    sequence: storyboard.sequence,
    style: storyboard.style,
    title: storyboard.title,
    updated_at: storyboard.updated_at,
  });
}

/**
 * Makes a storyboard of `input.character_id` under the client's `requestKey`, in one
 * transaction: a storyboard this key made before comes back as it is (`created: false`), a key
 * another access code used is a 409; an unknown character is a 404. Without `scenes`, the
 * sequence's split into four (`storyboard-scenes`) is admitted through `submitMany` with the
 * same key and the storyboard follows it; a refusal there (quota, rate limit, queue) stores
 * nothing. The storyboard's seed, every card's first seed, is drawn once here.
 */
export function createStoryboard(
  input: CreateStoryboardInput,
  { admit, provider, requestKey, session }: Submission,
) {
  if (!session) {
    throw accessRequired();
  }

  return transaction(database, () => {
    const existing = findStoryboardByKey(requestKey);

    if (existing) {
      if (existing.access_code_id !== session.codeId) {
        throw new GenerateError(
          409,
          "This request key was used for another request. Send a new one.",
          "request_key_conflict",
        );
      }

      return { created: false, storyboard: readStoryboard(existing.id) };
    }

    if (!getCharacter(input.character_id)) {
      throw new GenerateError(404, "Character not found.", "character_not_found");
    }

    const split = input.scenes
      ? null
      : submitMany(storyboardScenesDefinition, [{ sequence: input.sequence }], {
          admit,
          provider,
          requestKey,
          scope: { free: () => false, session },
        })[0];

    const id = insertStoryboard({
      accessCodeId: session.codeId,
      characterId: input.character_id,
      descriptions: input.scenes ?? null,
      requestKey,
      scenesGenerationId: split?.id ?? null,
      seed: randomInt(SEED_RANGE),
      sequence: input.sequence,
      style: input.style,
      title: input.title ?? null,
    });

    return { created: true, storyboard: readStoryboard(id) };
  });
}

/** Saves the title, style and every card's description; 404 for an id no storyboard has. */
export function saveStoryboardText(id: string, input: SaveStoryboardInput) {
  return transaction(database, () => {
    if (!findStoryboard(id)) {
      throw new GenerateError(404, "Storyboard not found.", "not_found");
    }

    saveStoryboard(id, input);

    return readStoryboard(id);
  });
}

/**
 * The seed a card's next generation renders with: the storyboard's for its first one; the last
 * one's when its description changed since (the edit is then the only change) or when that
 * generation failed (the same render, tried again); a new one when the same description is asked
 * for again after a render that worked or may still be working (another take of the scene).
 */
function nextSeed(
  storyboard: StoryboardRow,
  latest: CardGenerationRow | undefined,
  description: string,
) {
  if (!latest) {
    return storyboard.seed;
  }

  const { row } = currentGeneration(latest.generation_id);
  const failed = row.status === "failed" || row.status === "cancelled";
  const seed = seedOf(row) ?? latest.seed;

  return description !== latest.description || failed ? seed : randomInt(SEED_RANGE);
}

/**
 * Saves the body like `saveStoryboardText`, then renders the named cards, in one transaction
 * under the client's `requestKey`: a key this storyboard used before comes back with the
 * storyboard as it is and stores nothing (`created: false`), whatever the body; a key another
 * storyboard used is a 409. Each named card must have a description (422 naming it). The cards
 * go to `submitMany` of the shared image edit (the character as the one reference, the card's
 * prompt, its seed, `CARD_SIZE`): all admitted or none (quota, rate limit, queue), each its own
 * generation, recorded as that card's latest. The cards not named keep their generations.
 */
export function generateCards(
  id: string,
  input: GenerateCardsInput,
  { admit, provider, requestKey, session }: Submission,
) {
  if (!session) {
    throw accessRequired();
  }

  return transaction(database, () => {
    const storyboard = findStoryboard(id);

    if (!storyboard) {
      throw new GenerateError(404, "Storyboard not found.", "not_found");
    }

    const earlier = findCardRequest(requestKey);

    if (earlier) {
      if (earlier !== storyboard.id) {
        throw new GenerateError(
          409,
          "This request key was used for another request. Send a new one.",
          "request_key_conflict",
        );
      }

      return { created: false, storyboard: readStoryboard(storyboard.id) };
    }

    const positions = [...input.positions].sort((a, b) => a - b);

    for (const position of positions) {
      if (!input.descriptions[position]) {
        throw new GenerateError(
          422,
          `Card ${position + 1} has no scene description yet.`,
          "invalid_input",
        );
      }
    }

    saveStoryboard(storyboard.id, input);

    const history = historyByCard(storyboard.id);

    const planned = positions.map((position) => {
      const description = input.descriptions[position] ?? "";

      return {
        description,
        position,
        seed: nextSeed(storyboard, history[position]?.at(-1), description),
      };
    });

    const receipts = submitMany(
      imageEditDefinition,
      planned.map(({ description, position, seed }) => ({
        height: CARD_SIZE.height,
        // Part of the recipe: a card never comes back as another storyboard's (or card's) image.
        origin: { card: position, feature: "storyboard", storyboard_id: storyboard.id },
        prompt: compileCardPrompt(description, input.style),
        references: [{ character_id: storyboard.character_id }],
        seed,
        width: CARD_SIZE.width,
      })),
      { admit, provider, requestKey, scope: { free: () => false, session } },
    );

    insertCardGenerations(
      storyboard.id,
      requestKey,
      planned.map((card, index) => {
        const receipt = receipts[index];

        if (!receipt) {
          throw new Error(`submitMany answered no generation for card ${card.position}`);
        }

        return { ...card, generationId: receipt.id };
      }),
    );

    return { created: true, storyboard: readStoryboard(storyboard.id) };
  });
}

/** `GET /api/storyboards`: the workspace's latest storyboards, each with its cards' statuses. */
export function listWorkspaceStoryboards() {
  return storyboardListSchema.parse({
    storyboards: listStoryboards(LISTED).map((storyboard) => ({
      character: characterOf(storyboard),
      created_at: storyboard.created_at,
      id: storyboard.id,
      statuses: historyByCard(storyboard.id).map((history) => {
        const latest = history.at(-1);

        return latest ? currentGeneration(latest.generation_id).row.status : null;
      }),
      title: storyboard.title,
      updated_at: storyboard.updated_at,
    })),
  });
}
