import { randomInt } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { workflows } from "../../../app/server.ts";
import { generationSchema } from "../../contracts.ts";
import { findAccessCodeById } from "../access-codes.ts";
import type { Session } from "../access.server.ts";
import { findBySha256 } from "../assets.ts";
import type { AssetReference } from "../comfy-assets.ts";
import { comfyProvider, type Provider, providerError } from "../comfy-provider.ts";
import { providerTarget } from "../comfy-target.ts";
import { inFlightMax } from "../limits.ts";
import { assetsDirectory } from "../paths.ts";
import type { RecipeJson, WorkflowDefinition } from "./definition.ts";
import { GenerateError } from "./errors.ts";
import { finalize } from "./finalize.ts";
import {
  countInFlight,
  createGeneration,
  findGeneration,
  findInFlight,
  findPending,
  findReusable,
  type Generation,
  markQueued,
  markSubmitting,
  markUnknown,
  recordProviderInputs,
  transition,
} from "./generations.ts";
import { recipeHash } from "./recipe-hash.ts";

const UNKNOWN_MESSAGE =
  "Comfy may have accepted this generation before its job id was saved, so it is never submitted again automatically. Check your rendering backend for a job created at that time before starting a new generation with another seed.";

// Seeds Retry draws stay below 2^48, the largest range `randomInt` draws from.
const SEED_RANGE = 2 ** 48 - 1;

/** Rows this process is submitting. A `preparing` row outside it was left by a stopped server. */
const submitting = new Set<string>();

/**
 * Called once a request would create a row; it throws to refuse it. The HTTP routes pass the
 * rate limit (`answer`); a direct call (a script, a test) admits every row.
 */
export type Admit = () => void;

const admitAll: Admit = () => undefined;

/**
 * Who asks for a generation. There is one workspace per installation: the scope is the access
 * session the server read from the request (`null` without one), whose code pays for a new row,
 * and `free`, which existing generations come back without one.
 */
type GenerationScope = { free: (existing: Generation) => boolean; session: Session | null };

type SubmitOptions = { admit?: Admit; provider?: Provider; scope: GenerationScope };

// What a full queue says to wait, in seconds: about the time one render takes to get going.
const QUEUE_RETRY_AFTER = 30;

// A refresh of the rows that hold the in-flight cap asks Comfy about this many, oldest first, and
// a request waits this long for it.
const REFRESH_ROWS = 5;
const REFRESH_WAIT_MS = 5000;

let refreshing: Promise<unknown> | null = null;

/**
 * Brings the generations that hold the in-flight cap up to date (`readGeneration`): a `preparing`
 * row a stopped server left is settled, a job Comfy has finished or failed is finalized. Without
 * it, a generation nobody watches any more would hold the cap until someone opened its page.
 * Concurrent requests share one refresh, which waits for Comfy at most `REFRESH_WAIT_MS`; a
 * finalize still running then carries on.
 */
function refreshInFlight(provider: Provider) {
  refreshing ??= Promise.race([
    Promise.all(
      findInFlight(REFRESH_ROWS).map(async (id) => {
        try {
          await readGeneration(id, provider);
        } catch (error) {
          // `readGeneration` logs a finalize that failed itself; anything else is logged here,
          // and the row keeps its place.
          console.error(
            JSON.stringify({
              event: "in-flight.refresh-error",
              id,
              message: error instanceof Error ? error.message : "unknown",
            }),
          );
        }
      }),
    ),
    delay(REFRESH_WAIT_MS, undefined, { ref: false }),
  ]).finally(() => {
    refreshing = null;
  });

  return refreshing;
}

/** A stored file a recipe uploads, by the name the graph takes its provider reference under. */
type InputFile = { name: string; path: string };

/**
 * The stored files a recipe uploads (`assetInputs`), by the names the graph takes their
 * references under. Every one must be stored: a recipe names its inputs by content.
 */
function inputFiles<Input, Recipe extends RecipeJson>(
  definition: WorkflowDefinition<Input, Recipe>,
  recipe: Recipe,
): InputFile[] {
  return Object.entries(definition.assetInputs(recipe)).map(([name, sha256]) => {
    const asset = findBySha256(sha256);

    if (!asset) {
      throw new Error(`A ${definition.id} recipe names an input file that is not stored`);
    }

    return { name, path: resolve(assetsDirectory(), asset.path) };
  });
}

/**
 * Uploads the recipe's files (none for a scalar-only workflow, which then records no provider
 * inputs), builds the graph, submits it under the row's idempotency key and stores the job id the
 * moment it returns. A refusal before the provider can have taken the job fails the row; an
 * uncertain submit makes it `unknown`.
 */
async function send<Input, Recipe extends RecipeJson>(
  definition: WorkflowDefinition<Input, Recipe>,
  row: Pick<Generation, "id" | "idempotency_key">,
  recipe: Recipe,
  files: readonly InputFile[],
  provider: Provider,
) {
  let graph;

  try {
    const references = await Promise.all(
      files.map(async ({ name, path }): Promise<[string, AssetReference]> => [
        name,
        await provider.upload(path),
      ]),
    );

    const providerInputs = Object.fromEntries(references);

    if (references.length > 0) {
      recordProviderInputs(row.id, providerInputs);
    }

    graph = definition.buildGraph(recipe, providerInputs);
  } catch (cause) {
    const error = providerError(cause);
    console.error(JSON.stringify({ code: error.code, event: "comfy.upload-error", id: row.id }));
    transition(row.id, "preparing", "failed", {
      error_code: error.code,
      error_message: `${error.message} Nothing was submitted.`,
    });

    return;
  }

  let providerJobId;

  markSubmitting(row.id);

  try {
    providerJobId = await provider.submit(graph, row.idempotency_key);
  } catch (cause) {
    const error = providerError(cause);
    console.error(JSON.stringify({ code: error.code, event: "comfy.submit-error", id: row.id }));

    if (error.refused) {
      transition(row.id, "preparing", "failed", {
        error_code: error.code,
        error_message: error.message,
      });
    } else {
      markUnknown(row.id, { error_code: error.code, error_message: UNKNOWN_MESSAGE });
    }

    return;
  }

  markQueued(row.id, providerJobId);
}

type Claim = { id: string; reused: true } | { codeId: string; full: boolean; reused: false };

/**
 * What a recipe gets now: an existing generation (`reused`) with the same recipe that is done or
 * still on its way (a `preparing` row a stopped server left is settled first: one that never
 * reached Comfy fails and is not reused; one that may have is `unknown`, and is for a day), or
 * the code that pays for a new row and whether the in-flight cap is full. Without a session, only
 * an existing generation `free` allows comes back; anything else is a 401 asking for the code.
 * There is no await in it: one process cannot create the row twice, nor start more generations
 * than the cap.
 */
function claim(hash: string, scope: GenerationScope): Claim {
  let existing = findReusable(hash) ?? findPending(hash);

  // Settling an abandoned row can take it out of `findPending` (failed, or `unknown` for more
  // than a day), so look again until the row found is one that stays.
  while (existing && settleAbandoned(existing).status !== existing.status) {
    existing = findPending(hash);
  }

  if (existing && (scope.session || scope.free(existing))) {
    return { id: existing.id, reused: true };
  }

  const code = scope.session ? findAccessCodeById(scope.session.codeId) : null;

  if (!code) {
    throw new GenerateError(401, "Enter an access code to do this.", "access_required");
  }

  if (code.used >= code.max_generations) {
    throw new GenerateError(
      403,
      `This access code has used all ${code.max_generations} of its generations. Ask the owner for another code.`,
      "code_exhausted",
    );
  }

  return { codeId: code.id, full: countInFlight() >= inFlightMax(), reused: false };
}

/**
 * Admission to the provider, for a claim that would create a row: while `IN_FLIGHT_MAX`
 * generations are in flight, the rows holding the cap are refreshed once and the recipe claimed
 * again; if the cap is still full, the answer is a 503 `queue_full` and no row is created. An
 * existing generation found meanwhile comes back. Whatever is admitted goes to `start` with no
 * await in between, so the row it creates is there before another request claims the recipe. The
 * one step a durable waiting queue replaces.
 */
async function admitToProvider<Started>(
  claimed: Claim,
  again: () => Claim,
  provider: Provider,
  start: (admitted: Claim) => Started,
) {
  let admitted = claimed;

  if (!admitted.reused && admitted.full) {
    await refreshInFlight(provider);
    admitted = again();

    if (!admitted.reused && admitted.full) {
      throw new GenerateError(
        503,
        `Queue full: every rendering slot is taken. Try again in ${QUEUE_RETRY_AFTER} s.`,
        "queue_full",
        QUEUE_RETRY_AFTER,
      );
    }
  }

  // No await from the claim to `start`: the row it creates exists before another request claims.
  return start(admitted);
}

/**
 * Submits a prepared recipe: a generation with the same recipe that is done or still on its way
 * comes back as it is (`claim`); otherwise the request is `admit`ted (the rate limit), admitted
 * to the provider (`admitToProvider`), a `preparing` row (with its idempotency key) is stored,
 * the recipe's files go to Comfy, the graph is submitted under that key and the job id is saved
 * the moment it returns (`send`). A new row records the access code, which counts it
 * (`006-access-codes.sql`).
 */
async function submitRecipe<Input, Recipe extends RecipeJson>(
  definition: WorkflowDefinition<Input, Recipe>,
  prepared: { characterId?: string; motionId?: string; parentId?: string; recipe: Recipe },
  { admit = admitAll, provider = comfyProvider, scope }: SubmitOptions,
) {
  const recipe = definition.recipeSchema.parse(prepared.recipe);
  const files = inputFiles(definition, recipe);
  const hash = recipeHash(recipe);
  const first = claim(hash, scope);

  if (first.reused) {
    return { id: first.id, reused: true };
  }

  admit();

  // The new row is this process's to submit from the moment it exists (`settleAbandoned`).
  const started = await admitToProvider(
    first,
    () => claim(hash, scope),
    provider,
    (claimed) => {
      if (claimed.reused) {
        return { id: claimed.id, reused: true as const };
      }

      const row = createGeneration(definition, {
        accessCodeId: claimed.codeId,
        characterId: prepared.characterId,
        motionId: prepared.motionId,
        parentId: prepared.parentId,
        recipe,
        target: providerTarget(),
      });

      submitting.add(row.id);

      return { reused: false as const, row };
    },
  );

  if (started.reused) {
    return { id: started.id, reused: true };
  }

  const { row } = started;

  try {
    await send(definition, row, recipe, files, provider);
  } finally {
    submitting.delete(row.id);
  }

  return { id: row.id, reused: false };
}

/**
 * Starts a generation of `definition`'s workflow for a validated `input`: the definition resolves
 * the recipe once (`prepareRecipe`, which refuses an input it cannot render with a
 * `GenerateError`) for the target this server renders on, and `submitRecipe` submits it — or
 * returns the generation that already has it. The answer is the generation's receipt.
 */
export async function submit<Input, Recipe extends RecipeJson>(
  definition: WorkflowDefinition<Input, Recipe>,
  input: Input,
  options: SubmitOptions,
) {
  const prepared = definition.prepareRecipe(input, { target: providerTarget() });

  return submitRecipe(definition, prepared, options);
}

/**
 * Submits the parent's recipe again as its child (`parent_id`), with `seed` (the parent's for a
 * re-run, a new one for a retry), on the target this server renders on now, linked to the
 * parent's character and motion. A workflow that can no longer render the recipe is a 409.
 */
function submitChild(
  parent: Generation,
  seed: (current: number) => number,
  scope: GenerationScope,
  { admit, provider }: { admit: Admit; provider: Provider },
) {
  const definition = workflows.find(parent);
  const recipe = definition?.recipeSchema.parse(parent.recipe);

  const rebased =
    definition && recipe
      ? definition.rebase(recipe, {
          seed: seed(definition.seedOf(recipe)),
          target: providerTarget(),
        })
      : null;

  if (!definition || !rebased) {
    throw new GenerateError(409, "The workflow has changed since; start a new generation.");
  }

  return submitRecipe(
    definition,
    {
      characterId: parent.character_id ?? undefined,
      motionId: parent.motion_id ?? undefined,
      parentId: parent.id,
      recipe: rebased,
    },
    { admit, provider, scope },
  );
}

/**
 * `POST /api/generations/:id/retry`: a child of a failed generation (`parent_id` = `id`) with the
 * same recipe except a fresh random seed, rendered on the target this server renders on now (as
 * a re-run is), submitted like any generation. An `unknown` generation is never retried: Comfy
 * may still be rendering it (409).
 */
export async function retry(
  id: string,
  session: Session | null,
  provider: Provider = comfyProvider,
  admit: Admit = admitAll,
) {
  const parent = findGeneration(id);

  if (!parent) {
    throw new GenerateError(404, "Generation not found.");
  }

  if (parent.status === "unknown") {
    throw new GenerateError(
      409,
      "Comfy may still be rendering this generation, so it is not retried. Check your rendering backend for a job created at that time before starting a new generation with another seed.",
    );
  }

  if (parent.status !== "failed") {
    throw new GenerateError(
      409,
      `Only a failed generation can be retried; this one is ${parent.status}.`,
    );
  }

  return submitChild(
    parent,
    (current) => {
      let seed = randomInt(SEED_RANGE);

      while (seed === current) {
        seed = randomInt(SEED_RANGE);
      }

      return seed;
    },
    { free: () => false, session },
    { admit, provider },
  );
}

/**
 * `POST /api/generations/:id/rerun`: the generation's recipe again, seed included, on the target
 * this server renders on now. It goes through the same reuse as a new generation: with the target
 * unchanged the recipe hash is the parent's, so a done parent (or any done generation of that
 * recipe) is returned as it is (`reused`, no row, nothing submitted, free: no session needed) and
 * one still on its way is followed; otherwise — a failed parent, or another target — a child
 * (`parent_id` = `id`) with the same seed is submitted, which costs a render.
 */
export async function rerun(
  id: string,
  session: Session | null,
  provider: Provider = comfyProvider,
  admit: Admit = admitAll,
) {
  const parent = findGeneration(id);

  if (!parent) {
    throw new GenerateError(404, "Generation not found.");
  }

  return submitChild(
    parent,
    (current) => current,
    { free: (existing) => existing.status === "done", session },
    { admit, provider },
  );
}

/**
 * Settles a `preparing` row no submit in this process owns: the server stopped mid-submit. Until
 * the graph was handed to the provider (`submit_started_at`; with uploads, from the moment their
 * references were recorded) nothing was sent, so it failed; after that the job may exist on
 * Comfy, so it becomes `unknown` and is never resubmitted.
 */
export function settleAbandoned(row: Generation) {
  if (row.status !== "preparing" || submitting.has(row.id)) {
    return row;
  }

  return row.provider_inputs === null && row.submit_started_at === null
    ? transition(row.id, "preparing", "failed", {
        error_code: "interrupted",
        error_message: "The server stopped before sending this generation to Comfy.",
      })
    : markUnknown(row.id, { error_code: "unknown", error_message: UNKNOWN_MESSAGE });
}

/**
 * `GET /api/generations/:id`: the generation as `generationSchema`, `null` when there is none. A
 * row Comfy may have finished is finalized first, so a result the event stream missed lands here.
 */
export async function readGeneration(id: string, provider: Provider = comfyProvider) {
  const row = findGeneration(id);

  if (!row) {
    return null;
  }

  const settled = settleAbandoned(row);

  if (["queued", "running", "finalizing"].includes(settled.status)) {
    try {
      await finalize(id, provider);
    } catch (error) {
      // Comfy or the download failed; the stored row is still the truth, and the next read retries.
      console.error(
        JSON.stringify({
          event: "finalize.error",
          id,
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
  }

  return generationSchema.parse(findGeneration(id) ?? settled);
}
