import { randomInt } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { GenerationReceipt } from "../../contracts.ts";
import { findAccessCodeById } from "../access-codes.ts";
import type { Session } from "../access.server.ts";
import { findBySha256 } from "../assets.ts";
import type { AssetReference } from "../comfy-assets.ts";
import { comfyProvider, type Provider, providerError } from "../comfy-provider.ts";
import { providerTarget } from "../comfy-target.ts";
import { inFlightMax } from "../limits.ts";
import { assetsDirectory } from "../paths.ts";
import {
  type PreparedRecipe,
  type WorkflowDefinition,
  type WorkflowRecipe,
  workflows,
} from "./definition.ts";
import { GenerateError } from "./errors.ts";
import { finalize } from "./finalize.ts";
import {
  countInFlight,
  countWaiting,
  createGeneration,
  findByRequestKey,
  findGeneration,
  findInFlight,
  findPending,
  findReusable,
  hashRecipe,
  type DecodedGeneration,
  type Generation,
  markQueued,
  markSubmitting,
  markUnknown,
  recordProviderInputs,
  releaseClaim,
  snapshot,
  transition,
} from "./generations.ts";

/**
 * The endpoint `provider` submits to: its own `target`, or this server's (`providerTarget`) for a
 * provider that does not say.
 */
export function targetOf(provider: Provider) {
  return provider.target?.() ?? providerTarget();
}

const UNKNOWN_MESSAGE =
  "Comfy may have accepted this generation before its job id was saved, so it is never submitted again automatically. Check your rendering backend for a job created at that time before starting a new generation with another seed.";

// Seeds Retry draws stay below 2^48, the largest range `randomInt` draws from.
const SEED_RANGE = 2 ** 48 - 1;

declare global {
  // Rows this process is submitting (`submitting`).
  var openPhotonSubmitting: Set<string> | undefined;
}

/**
 * Rows this process is submitting. A `preparing` row outside it was left by a stopped server. Kept
 * on `globalThis`, so a dev server that reloads this module still knows the rows the dispatcher
 * (started once, with the module as it was) is submitting.
 */
const submitting = (globalThis.openPhotonSubmitting ??= new Set<string>());

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

/**
 * How a generation is asked for: the scope, the rate limit (`admit`), the provider, and the
 * client's `requestKey` (a UUID), which makes asking again with it return the same generation.
 */
type SubmitOptions = {
  admit?: Admit;
  provider?: Provider;
  requestKey?: string;
  scope: GenerationScope;
};

// What a full queue says to wait, in seconds: about the time one render takes to get going.
const QUEUE_RETRY_AFTER = 30;

// A refresh of the rows that hold the in-flight cap asks Comfy about this many, oldest first, and
// a request waits this long for it.
const REFRESH_ROWS = 5;
const REFRESH_WAIT_MS = 5000;

let refreshing: Promise<unknown> | null = null;

/**
 * Brings the generations that hold the in-flight cap up to date (`readGeneration`): a `preparing`
 * row a stopped server left is settled, a job Comfy has finished or failed is finalized. The
 * dispatcher does the same every few seconds; a request that finds the cap full does it once
 * before it waits in line, so a place freed since the last poll is not missed. Concurrent
 * requests share one refresh, which waits for Comfy at most `REFRESH_WAIT_MS`; a finalize still
 * running then carries on.
 */
function refreshInFlight(provider: Provider) {
  refreshing ??= Promise.race([
    Promise.all(
      findInFlight(REFRESH_ROWS, provider.target?.()).map(async (id) => {
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
function inputFiles<Input, Recipe extends WorkflowRecipe>(
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
async function send<Input, Recipe extends WorkflowRecipe>(
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

/**
 * What a recipe gets now: an existing generation with the same recipe (`reused`), or the code
 * that pays for a new row, whether every place in flight is taken (`full`) and whether others
 * already wait in line for this endpoint (`lineAhead`, so a new one never overtakes them).
 */
type Claim =
  | { reused: true; row: Generation }
  | { codeId: string; full: boolean; lineAhead: boolean; reused: false };

/**
 * The generation of `workflow` with this recipe that is done or still on its way (in line too):
 * a `preparing` row a stopped server left is settled first (`settleAbandoned`: one never handed
 * to Comfy goes back in line and is reused; one that may have been is `unknown`, and is for a
 * day).
 */
function existingFor(workflow: { id: string; version: number }, hash: string) {
  let existing = findReusable(hash, workflow) ?? findPending(hash, workflow);

  // Settling an abandoned row can take it out of `findPending` (`unknown` for more than a day),
  // so look again until the row found is one that stays.
  while (existing && settleAbandoned(existing).status !== existing.status) {
    existing = findPending(hash, workflow);
  }

  return existing;
}

/**
 * The access code of `scope` that pays for `rows` new generations: a 401 asking for the code
 * without one, a 403 `code_exhausted` when it has fewer than `rows` left.
 */
function payingCode(scope: GenerationScope, rows: number) {
  const code = scope.session ? findAccessCodeById(scope.session.codeId) : null;

  if (!code) {
    throw new GenerateError(401, "Enter an access code to do this.", "access_required");
  }

  if (code.used + rows > code.max_generations) {
    const left = Math.max(0, code.max_generations - code.used);

    throw new GenerateError(
      403,
      left === 0
        ? `This access code has used all ${code.max_generations} of its generations. Ask the owner for another code.`
        : `This access code has ${left} of its ${code.max_generations} generations left, and this request needs ${rows}. Nothing was started.`,
      "code_exhausted",
    );
  }

  return code;
}

/**
 * A recipe's claim (`Claim`). Without a session, only an existing generation `free` allows comes
 * back; anything else is a 401 asking for the code. There is no await in it: one process cannot
 * create the row twice, nor start more generations than the cap.
 */
function claim(
  workflow: { id: string; version: number },
  hash: string,
  scope: GenerationScope,
  provider: Provider,
): Claim {
  const existing = existingFor(workflow, hash);

  if (existing && (scope.session || scope.free(existing))) {
    return { reused: true, row: existing };
  }

  return {
    codeId: payingCode(scope, 1).id,
    full: countInFlight(provider.target?.()) >= inFlightMax(),
    lineAhead: countWaiting(targetOf(provider)) > 0,
    reused: false,
  };
}

/** `IN_FLIGHT_MAX=0`: the server takes no new generation, not even in line. */
function refuseWhenClosed() {
  if (inFlightMax() === 0) {
    throw new GenerateError(
      503,
      `Queue full: this server takes no new generations right now. Try again in ${QUEUE_RETRY_AFTER} s.`,
      "queue_full",
      QUEUE_RETRY_AFTER,
    );
  }
}

/**
 * Admission to the provider, for a claim that would create a row: with `IN_FLIGHT_MAX=0` the
 * answer is a 503 `queue_full` and no row is created. While the in-flight cap is full and nobody
 * waits in line, the rows holding it are refreshed once and the recipe claimed again (an
 * existing generation found meanwhile comes back). Whatever is admitted goes to `start`, which
 * stores the row `preparing` when a place is free and nobody waits, or `waiting` in line for the
 * dispatcher; no await in between, so the row exists before another request claims the recipe.
 */
async function admitToProvider<Started>(
  claimed: Claim,
  again: () => Claim,
  provider: Provider,
  start: (admitted: Claim) => Started,
) {
  let admitted = claimed;

  if (!admitted.reused) {
    refuseWhenClosed();
  }

  if (!admitted.reused && admitted.full && !admitted.lineAhead) {
    await refreshInFlight(provider);
    admitted = again();
  }

  // No await from the claim to `start`: the row it creates exists before another request claims.
  return start(admitted);
}

/**
 * The receipt of a row: a `waiting` one says so with its place in line (`position`), as a 202;
 * any other is `{ id, reused }`.
 */
function receiptOf(row: Omit<Generation, "recipe">, reused: boolean): GenerationReceipt {
  const { position } = snapshot(row);

  return position === null
    ? { id: row.id, reused }
    : { id: row.id, position, reused, status: "waiting" };
}

/**
 * The receipt again for a request key already used (`findByRequestKey`): the same generation, as
 * it was answered the first time (`reused: false`), for the access code that made it; anyone
 * else's request with that key is a 409.
 */
function replayed(row: Generation, scope: GenerationScope) {
  if (row.access_code_id === null || row.access_code_id !== scope.session?.codeId) {
    throw new GenerateError(
      409,
      "This request key was used for another request. Send a new one.",
      "request_key_conflict",
    );
  }

  return receiptOf(row, false);
}

// SQLITE_CONSTRAINT_UNIQUE: another process stored the request key first.
const UNIQUE_VIOLATION = 2067;

/**
 * Submits a prepared recipe: a generation with the same recipe that is done or still on its way
 * comes back as it is (`claim`); otherwise the request is `admit`ted (the rate limit) and
 * admitted to the provider (`admitToProvider`). A row stored `waiting` is answered at once with
 * its place in line; the dispatcher submits it when a place opens. A `preparing` row (with its
 * idempotency key) is submitted here: the recipe's files go to Comfy, the graph is submitted
 * under that key and the job id is saved the moment it returns (`send`). A new row records the
 * access code, which counts it (`006-access-codes.sql`), and `requestKey`, which a concurrent
 * request with the same key finds instead of storing a second row.
 */
async function submitRecipe<Input, Recipe extends WorkflowRecipe>(
  definition: WorkflowDefinition<Input, Recipe>,
  prepared: PreparedRecipe<Recipe> & { parentId?: string },
  { admit = admitAll, provider = comfyProvider, requestKey, scope }: SubmitOptions,
): Promise<GenerationReceipt> {
  const { hash, recipe } = hashRecipe(definition, prepared.recipe);
  const files = inputFiles(definition, recipe);
  const first = claim(definition, hash, scope, provider);

  if (first.reused) {
    return receiptOf(first.row, true);
  }

  admit();

  // The new row is this process's to submit from the moment it exists (`settleAbandoned`).
  const started = await admitToProvider(
    first,
    () => claim(definition, hash, scope, provider),
    provider,
    (claimed): { receipt: GenerationReceipt } | { row: DecodedGeneration<Recipe> } => {
      if (claimed.reused) {
        return { receipt: receiptOf(claimed.row, true) };
      }

      const made = requestKey === undefined ? null : findByRequestKey(definition.id, requestKey);

      if (made) {
        return { receipt: replayed(made, scope) };
      }

      const waiting = claimed.full || claimed.lineAhead;
      let row;

      try {
        row = createGeneration(definition, {
          accessCodeId: claimed.codeId,
          characterId: prepared.characterId,
          motionId: prepared.motionId,
          parentId: prepared.parentId,
          recipe,
          requestKey,
          status: waiting ? "waiting" : "preparing",
          target: targetOf(provider),
        });
      } catch (error) {
        const raced =
          requestKey !== undefined &&
          error instanceof Error &&
          "errcode" in error &&
          error.errcode === UNIQUE_VIOLATION
            ? findByRequestKey(definition.id, requestKey)
            : null;

        if (!raced) {
          throw error;
        }

        return { receipt: replayed(raced, scope) };
      }

      if (waiting) {
        return { receipt: receiptOf(row, false) };
      }

      submitting.add(row.id);

      return { row };
    },
  );

  if ("receipt" in started) {
    return started.receipt;
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
 * returns the generation that already has it. The answer is the generation's receipt. A
 * `requestKey` the workflow already has returns its generation before anything is resolved, so a
 * request repeated after a lost answer gets the same generation, even one whose seed was drawn
 * at random.
 */
export async function submit<Input, Recipe extends WorkflowRecipe>(
  definition: WorkflowDefinition<Input, Recipe>,
  input: Input,
  options: SubmitOptions,
) {
  const made =
    options.requestKey === undefined ? null : findByRequestKey(definition.id, options.requestKey);

  if (made) {
    return replayed(made, options.scope);
  }

  const prepared = definition.prepareRecipe(input, {
    target: targetOf(options.provider ?? comfyProvider),
  });

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
          target: targetOf(provider),
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
 * `POST /api/generations/:id/retry`: a child of a failed (or cancelled) generation (`parent_id` =
 * `id`) with the same recipe except a fresh random seed, rendered on the target this server
 * renders on now (as a re-run is), submitted like any generation. An `unknown` generation is
 * never retried: Comfy may still be rendering it (409).
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

  if (parent.status !== "failed" && parent.status !== "cancelled") {
    throw new GenerateError(
      409,
      `Only a failed or cancelled generation can be retried; this one is ${parent.status}.`,
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
 * Settles a `preparing` row no submit in this process owns: the server stopped mid-submit (one
 * process runs per installation, so its claim, `claimed_by`, is a stopped one's). Until the graph
 * was handed to the provider (`submit_started_at`) nothing was sent, so it goes back in line
 * where it was (`releaseClaim`), its access code's count kept; after that the job may exist on
 * Comfy, so it becomes `unknown` and is never resubmitted. `recoverAfterRestart`
 * (`dispatcher.ts`) applies it to every such row at boot.
 */
export function settleAbandoned(row: Generation) {
  if (row.status !== "preparing" || submitting.has(row.id)) {
    return row;
  }

  return (
    releaseClaim(row.id) ??
    markUnknown(row.id, { error_code: "unknown", error_message: UNKNOWN_MESSAGE })
  );
}

/**
 * Submits a row the dispatcher claimed (`claimNextWaiting`, now `preparing` for this process) as
 * an inline admission does (`send`). A row whose workflow no feature registers any more, or whose
 * input files are gone, fails before anything is sent, which gives its access code's count back.
 */
export async function sendClaimed(row: Generation, provider: Provider) {
  submitting.add(row.id);

  try {
    const definition = workflows.find(row);
    let prepared;

    try {
      if (!definition) {
        throw new Error(
          `${row.workflow_id} v${row.workflow_version} is a workflow no feature registers any more.`,
        );
      }

      const recipe = definition.recipeSchema.parse(row.recipe);

      prepared = { definition, files: inputFiles(definition, recipe), recipe };
    } catch (error) {
      transition(row.id, "preparing", "failed", {
        error_code: "unknown",
        error_message: `This generation could not be prepared: ${error instanceof Error ? error.message : "unknown error"} Nothing was submitted.`,
      });

      return;
    }

    await send(prepared.definition, row, prepared.recipe, prepared.files, provider);
  } finally {
    submitting.delete(row.id);
  }
}

/**
 * `GET /api/generations/:id`: the generation as `generationSchema` (`snapshot`: a `waiting` one
 * with its place in line), `null` when there is none. A row Comfy may have finished is finalized
 * first, so a result the event stream missed lands here.
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

  return snapshot(findGeneration(id) ?? settled);
}
