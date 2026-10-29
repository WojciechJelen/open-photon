// A batch's admission and reads. Admission is the generation service's (`submitMany`: every item
// validated, quota checked and stored `waiting` at once, or nothing); the dispatcher renders the
// items within `IN_FLIGHT_MAX` with no browser open. This module only records which generations
// make up a batch, under the request key that admitted them.
import { allowanceOf, findAccessCodeById } from "../../../shared/server/access-codes.ts";
import type { Session } from "../../../shared/server/access.server.ts";
import type { Provider } from "../../../shared/server/comfy-provider.ts";
import { database } from "../../../shared/server/db.server.ts";
import {
  type WorkflowDefinition,
  type WorkflowRecipe,
  workflows,
} from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import {
  findLatestAttempt,
  type Generation,
  snapshot,
} from "../../../shared/server/generation/generations.ts";
import { type Admit, submitMany } from "../../../shared/server/generation/service.ts";
import { transaction } from "../../../shared/server/migrate.ts";
import { getCharacter } from "../../characters/api.ts";
import type { DraftSnapshot } from "../../motionTransfer/api.ts";
import { type Batch, batchSchema, type CreateBatchInput } from "../contracts.ts";
import { planItems } from "../variations.ts";
import {
  findBatch,
  findBatchByKey,
  findItems,
  insertBatch,
  type ItemRow,
  listBatches,
} from "./repository.ts";

// How many batches `GET /api/batches` lists.
const LISTED = 50;

// The workflow a batch renders: Motion Transfer, found in the composed registry (`workflows`,
// set by `src/app/server.ts`) by its stored identity, so batches import none of its modules.
const MOTION_TRANSFER = { workflow_id: "motion-transfer", workflow_version: 1 };

/** Motion Transfer's definition as the app composes it; throws when it is not composed. */
export function motionTransferWorkflow() {
  const definition = workflows.find(MOTION_TRANSFER);

  if (!definition) {
    throw new Error("Motion Transfer v1 is not composed (src/app/server.ts)");
  }

  return definition;
}

/**
 * The Motion Transfer generation input (`POST /api/generate`'s body) of an item's draft, as the
 * wizard's Generate sends it: a blank look and the `"default"` seed are left out, so the
 * workflow's own fill them and an item's recipe is the one a single take of that shot has.
 */
function generationInput(draft: DraftSnapshot) {
  return {
    character_id: draft.character,
    motion_asset_id: draft.motion,
    prompt: draft.prompt?.trim() || undefined,
    seed: draft.seed === "default" ? undefined : draft.seed,
  };
}

/**
 * An item's current generation: its first one, followed through each failed or cancelled
 * generation's child (the shared retry or re-run) to the latest attempt, and how many that took.
 */
function currentGeneration(item: ItemRow) {
  const current = findLatestAttempt(item.generation_id);

  if (!current) {
    throw new Error(`Batch item ${item.position} names no stored generation`);
  }

  return current;
}

/** The seed a generation renders with, read from its recipe by its workflow (`seedOf`). */
function seedOf(row: Generation) {
  const definition = workflows.find(row);
  const recipe = definition?.recipeSchema.safeParse(row.recipe);

  return definition && recipe?.success ? definition.seedOf(recipe.data) : null;
}

/**
 * A batch with every item's current generation (`batchSchema`); `null` for an id no batch has.
 * Batches need a session, which sees every character of the workspace.
 */
export function readBatch(id: string): Batch | null {
  const batch = findBatch(id);

  if (!batch) {
    return null;
  }

  const items = findItems(batch.id).map((item) => {
    const { attempt, row } = currentGeneration(item);
    const character = row.character_id ? getCharacter(row.character_id) : null;

    return {
      attempt,
      character: character && {
        id: character.id,
        image: character.image,
        is_sample: character.is_sample,
        origin: character.origin,
        title: character.title,
      },
      generation: snapshot(row),
      position: item.position,
      reused: item.reused,
      seed: seedOf(row),
      variation: item.variation,
    };
  });

  return batchSchema.parse({
    created_at: batch.created_at,
    id: batch.id,
    items,
    kind: batch.kind,
    shot: batch.shot,
  });
}

/**
 * Admits a batch of `definition`'s generations (Motion Transfer's) for `input`, under the
 * client's `requestKey`, in one transaction: a batch this key admitted before comes back as it
 * is (`created: false`) and nothing is stored or charged, a key another access code used is a
 * 409; otherwise every item goes through `submitMany` (each input validated, the quota checked
 * for every new item, all stored `waiting` or none; an existing take with an item's recipe comes
 * back free, `reused`) and the batch is stored with its items in order. Any refusal stores
 * nothing: no batch, no generation, no charge. `admit` is the request's rate limit.
 */
export function createBatch<Input, Recipe extends WorkflowRecipe>(
  definition: WorkflowDefinition<Input, Recipe>,
  input: CreateBatchInput,
  {
    admit,
    provider,
    requestKey,
    session,
  }: { admit?: Admit; provider?: Provider; requestKey: string; session: Session | null },
) {
  if (!session) {
    throw new GenerateError(401, "Enter an access code to do this.", "access_required");
  }

  return transaction(database, () => {
    const existing = findBatchByKey(requestKey);

    if (existing) {
      if (existing.access_code_id !== session.codeId) {
        throw new GenerateError(
          409,
          "This request key was used for another request. Send a new one.",
          "request_key_conflict",
        );
      }

      return { batch: readBatch(existing.id), created: false };
    }

    const planned = planItems(input.shot, input.variation);

    const receipts = submitMany(
      definition,
      planned.map(({ draft }) => generationInput(draft)),
      { admit, provider, requestKey, scope: { free: () => false, session } },
    );

    // A character batch's items set the character; the common shot has none (`undefined` is
    // left out when it is stored).
    const shot =
      input.variation.kind === "characters" ? { ...input.shot, character: undefined } : input.shot;

    const id = insertBatch({
      accessCodeId: session.codeId,
      items: planned.map(({ variation }, index) => {
        const receipt = receipts[index];

        if (!receipt) {
          throw new Error(`submitMany answered no generation for item ${index}`);
        }

        return { generationId: receipt.id, reused: receipt.reused, variation };
      }),
      kind: input.variation.kind,
      requestKey,
      shot,
    });

    return { batch: readBatch(id), created: true };
  });
}

/**
 * `GET /api/batches`: the workspace's latest batches (one workspace per installation, so every
 * session sees the same ones), each with its items' current statuses, and what the session's
 * access code still allows.
 */
export function listWorkspaceBatches(session: Session) {
  const code = findAccessCodeById(session.codeId);

  if (!code) {
    throw new GenerateError(401, "Enter an access code to do this.", "access_required");
  }

  return {
    allowance: allowanceOf(code),
    batches: listBatches(LISTED).map((batch) => ({
      created_at: batch.created_at,
      id: batch.id,
      kind: batch.kind,
      statuses: findItems(batch.id).map((item) => currentGeneration(item).row.status),
    })),
  };
}
