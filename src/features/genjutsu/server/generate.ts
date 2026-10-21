import { randomInt } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { findAccessCodeById } from "../../../shared/server/access-codes.ts";
import {
  readLimitedBody,
  readSession,
  type Session,
} from "../../../shared/server/access.server.ts";
import { findAsset, findBySha256, type StoredAsset } from "../../../shared/server/assets.ts";
import {
  inFlightMax,
  requesterKeys,
  returnToken,
  takeToken,
} from "../../../shared/server/limits.ts";
import { assetsDirectory } from "../../../shared/server/paths.ts";
import { generateInputSchema, generationSchema, MAX_CLIP_MS } from "../contracts.ts";
import { buildGraph } from "../workflows/build-graph.ts";
import { motionTransferModels, motionTransferWorkflow } from "../workflows/registry.ts";
import { findCharacter } from "./characters.server.ts";
import { comfyProvider, type Provider, providerError, providerTarget } from "./comfy.ts";
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
  markUnknown,
  recordProviderInputs,
  transition,
} from "./generations.ts";
import { anglePresets, generateDefaults } from "./presets.ts";
import { type Recipe, recipeHash } from "./recipe.ts";
import { publicAsset, sampleMotionTitle, sourceClip, visibleCharacter } from "./shot.ts";

/**
 * A request that cannot become a generation: `status` is the HTTP status that says why, `reason`
 * a code the UI acts on (`access_required` asks for the access code), `retryAfter` the seconds to
 * wait before asking again (`rate_limited`, `queue_full`).
 */
export class GenerateError extends Error {
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503;
  reason: string | undefined;
  retryAfter: number | undefined;
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
    message: string,
    reason?: string,
    retryAfter?: number,
  ) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.retryAfter = retryAfter;
  }
}

const UNKNOWN_MESSAGE =
  "Comfy may have accepted this generation before its job id was saved, so it is never submitted again automatically. See the README, “Generation state and recovery”.";

// Seeds Retry draws stay below 2^48, the largest range `randomInt` draws from.
const SEED_RANGE = 2 ** 48 - 1;

/** Rows this process is submitting. A `preparing` row outside it was left by a stopped server. */
const submitting = new Set<string>();

type Files = { drivingVideo: StoredAsset; referenceImage: StoredAsset };

/**
 * Called once a request would create a row; it throws to refuse it. The HTTP routes pass the
 * rate limit (`answer`); a direct call (a script, a test) admits every row.
 */
type Admit = () => void;

const admitAll: Admit = () => undefined;

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

async function send(row: Generation, files: Files, provider: Provider) {
  let graph;

  try {
    const [driving_video, reference_image] = await Promise.all([
      provider.upload(resolve(assetsDirectory(), files.drivingVideo.path)),
      provider.upload(resolve(assetsDirectory(), files.referenceImage.path)),
    ]);

    recordProviderInputs(row.id, { driving_video, reference_image });
    graph = buildGraph(motionTransferWorkflow.graph, motionTransferWorkflow.inputsMap, {
      ...row.recipe.params,
      driving_video,
      reference_image,
    });
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
 * Pipeline steps 3–6 for a recipe: a generation with the same recipe that is done or still on
 * its way is returned as is; otherwise a `preparing` row (with its idempotency key) is stored,
 * both files go to Comfy, the graph is submitted under that key, and the job id is saved the
 * moment it returns. A `preparing` row a stopped server left behind is settled first: one that
 * never reached Comfy fails and is not reused; one that may have is `unknown` and is, for a day
 * (`findPending`).
 *
 * A new row needs a session whose access code has generations left; the row records the code,
 * which counts it (`006-access-codes.sql`). Without a session, only an existing generation that
 * `free` allows comes back; anything else is a 401 asking for the code. A new row is `admit`ted
 * first, and only while fewer than `IN_FLIGHT_MAX` generations are in flight: when that looks
 * full, the rows holding it are refreshed, and if it still is, the answer is a 503 `queue_full`
 * and no row is created. An existing generation is returned whatever the cap.
 */
async function submitRecipe(
  {
    characterId,
    files,
    free,
    parentId,
    recipe,
    session,
  }: {
    characterId: string | null;
    files: Files;
    free: (existing: Generation) => boolean;
    parentId?: string;
    recipe: Recipe;
    session: Session | null;
  },
  provider: Provider,
  admit: Admit,
) {
  const hash = recipeHash(recipe);

  /**
   * What the recipe gets now: an existing generation (`reused`), or the code that pays for a new
   * row and whether the cap is full. There is no await from it to the insert: one process cannot
   * create the row twice, nor start more generations than the cap.
   */
  const claim = () => {
    let existing = findReusable(hash) ?? findPending(hash);

    // Settling an abandoned row can take it out of `findPending` (failed, or `unknown` for more
    // than a day), so look again until the row found is one that stays.
    while (existing && settleAbandoned(existing).status !== existing.status) {
      existing = findPending(hash);
    }

    if (existing && (session || free(existing))) {
      return { id: existing.id, reused: true as const };
    }

    const code = session ? findAccessCodeById(session.codeId) : null;

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

    return { code, full: countInFlight() >= inFlightMax(), reused: false as const };
  };

  let claimed = claim();

  if (claimed.reused) {
    return { id: claimed.id, reused: true };
  }

  admit();

  if (claimed.full) {
    await refreshInFlight(provider);
    claimed = claim();

    if (claimed.reused) {
      return { id: claimed.id, reused: true };
    }

    if (claimed.full) {
      throw new GenerateError(
        503,
        `Queue full: every rendering slot is taken. Try again in ${QUEUE_RETRY_AFTER} s.`,
        "queue_full",
        QUEUE_RETRY_AFTER,
      );
    }
  }

  const row = createGeneration({
    accessCodeId: claimed.code.id,
    characterId: characterId ?? undefined,
    parentId,
    recipe,
  });

  submitting.add(row.id);

  try {
    await send(row, files, provider);
  } finally {
    submitting.delete(row.id);
  }

  return { id: row.id, reused: false };
}

/**
 * `POST /api/generate` (`handleGenerate`): the input contract is `generateInputSchema`. Without
 * a session (`session` is `null`) it answers only with a done pre-rendered sample generation of
 * the same recipe, the free sample × sample lookup.
 */
export async function generate(
  input: z.output<typeof generateInputSchema>,
  session: Session | null,
  provider: Provider = comfyProvider,
  admit: Admit = admitAll,
) {
  const motion = findAsset(input.motion_asset_id);

  if (motion?.kind !== "video") {
    throw new GenerateError(404, "Motion clip not found.");
  }

  if (motion.duration_ms === null || motion.width === null || motion.height === null) {
    throw new GenerateError(422, "This clip has not been probed. Upload it again.");
  }

  if (motion.duration_ms > MAX_CLIP_MS) {
    throw new GenerateError(422, "This clip is longer than 8 seconds. Trim it first.");
  }

  const character = findCharacter(input.character_id);

  if (!character) {
    throw new GenerateError(404, "Character not found.");
  }

  if (character.origin === "upload" && character.consent_at === null) {
    throw new GenerateError(422, "This character was uploaded without likeness consent.");
  }

  const image = findAsset(character.image_asset_id);

  if (!image) {
    throw new Error(`Character ${character.id} has no image asset`);
  }

  const angle =
    input.angle === undefined
      ? undefined
      : anglePresets.angles.find((preset) => preset.id === input.angle);

  if (input.angle !== undefined && !angle) {
    throw new GenerateError(422, `There is no reshoot angle “${input.angle}”.`);
  }

  const portrait = motion.height >= motion.width;
  const prompt = input.prompt ?? generateDefaults.prompt;

  return submitRecipe(
    {
      characterId: character.id,
      files: { drivingVideo: motion, referenceImage: image },
      free: (existing) => existing.status === "done" && existing.is_prerendered,
      recipe: {
        angle: angle?.id,
        inputs: { driving_video_sha256: motion.sha256, reference_image_sha256: image.sha256 },
        models: motionTransferModels,
        params: {
          fragment_length: 81,
          height: portrait ? 848 : 480,
          // The angle is a prompt fragment, not a node field (src/features/genjutsu/workflows/README.md).
          prompt: angle ? `${prompt.trimEnd()} ${angle.fragment}` : prompt,
          // A fixed default, so the same choices are the same recipe (and reuse its result).
          seed: input.seed ?? generateDefaults.seed,
          width: portrait ? 480 : 848,
        },
        target: providerTarget(),
        workflow: { id: "motion-transfer", sha256: motionTransferWorkflow.sha256, version: 1 },
      },
      session,
    },
    provider,
    admit,
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
      "Comfy may still be rendering this generation, so it is not retried. See the README, “Generation state and recovery”, then start a new generation.",
    );
  }

  if (parent.status !== "failed") {
    throw new GenerateError(
      409,
      `Only a failed generation can be retried; this one is ${parent.status}.`,
    );
  }

  let seed = randomInt(SEED_RANGE);

  while (seed === parent.recipe.params.seed) {
    seed = randomInt(SEED_RANGE);
  }

  return submitChild(
    parent,
    { ...parent.recipe, params: { ...parent.recipe.params, seed }, target: providerTarget() },
    { admit, free: () => false, session },
    provider,
  );
}

/**
 * `POST /api/generations/:id/rerun`: the generation's recipe again, seed included, on the target
 * this server renders on now. It goes through the same reuse as `generate`: with the target
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
    { ...parent.recipe, target: providerTarget() },
    { admit, free: (existing) => existing.status === "done", session },
    provider,
  );
}

/**
 * Submits `recipe` (the parent's, changed by a retry or re-run) as a child of `parent`; `access`
 * as in `submitRecipe`.
 */
async function submitChild(
  parent: Generation,
  recipe: Recipe,
  access: { admit: Admit; free: (existing: Generation) => boolean; session: Session | null },
  provider: Provider,
) {
  if (
    recipe.workflow.id !== "motion-transfer" ||
    recipe.workflow.version !== 1 ||
    recipe.workflow.sha256 !== motionTransferWorkflow.sha256
  ) {
    throw new GenerateError(409, "The workflow has changed since; start a new generation.");
  }

  const drivingVideo = findBySha256(recipe.inputs.driving_video_sha256);
  const referenceImage = findBySha256(recipe.inputs.reference_image_sha256);

  if (!drivingVideo || !referenceImage) {
    throw new Error(`Generation ${parent.id} names input files that are not stored`);
  }

  return submitRecipe(
    {
      characterId: parent.character_id,
      files: { drivingVideo, referenceImage },
      free: access.free,
      parentId: parent.id,
      recipe,
      session: access.session,
    },
    provider,
    access.admit,
  );
}

/**
 * Settles a `preparing` row no submit in this process owns: the server stopped mid-submit. With
 * no provider inputs recorded nothing was sent, so it failed; after that the job may exist on
 * Comfy, so it becomes `unknown` and is never resubmitted.
 */
export function settleAbandoned(row: Generation) {
  if (row.status !== "preparing" || submitting.has(row.id)) {
    return row;
  }

  return row.provider_inputs === null
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

/**
 * What `/g/:id` shows: the generation as stored (a `preparing` row a stopped server left is
 * settled first), its recipe, the motion clip it was made from (`source`, the asset the wizard's
 * `?motion=` names) with its sample title if it is one (`motionTitle`), the character with its
 * image as `signedIn` may see it (`visibleCharacter`), the result and its poster once done
 * (`final`, `poster`) and, for a child, whether it kept its parent's seed (a re-run) or not (a
 * retry); `null` for a malformed or unknown id (the page is then a 404). It
 * never asks Comfy, so the page renders at once even when Comfy does not answer: the page's event
 * stream finalizes a row Comfy has finished, as `GET /api/generations/:id` does.
 */
export function readResult(id: string, signedIn: boolean) {
  const parsed = z.uuid().safeParse(id);
  const stored = parsed.success ? findGeneration(parsed.data) : null;

  if (!stored) {
    return null;
  }

  const row = settleAbandoned(stored);
  const source = sourceClip(row);
  const parent = row.parent_id ? findGeneration(row.parent_id) : null;
  const character = row.character_id ? findCharacter(row.character_id) : null;

  const done = row.status === "done";

  return {
    character: visibleCharacter(character, signedIn),
    final: done && row.final_asset_id ? publicAsset(row.final_asset_id) : null,
    generation: generationSchema.parse(row),
    motionTitle: sampleMotionTitle(source.id),
    poster: done && row.poster_asset_id ? publicAsset(row.poster_asset_id) : null,
    prerendered: row.is_prerendered,
    recipe: row.recipe,
    rerunOfParent: parent?.recipe.params.seed === row.recipe.params.seed,
    source,
  };
}

/**
 * The answer to a request that starts a generation: 201 `{ id, reused: false }` for a submitted
 * one, 200 with `reused: true` for an existing one returned instead, or the `GenerateError`'s
 * status with `{ error, reason?, retry_after? }` (and `Retry-After`).
 *
 * Every answer but an existing result takes a token from the request's client and access code
 * (`takeToken`, `GENERATE_RATE_LIMIT` a minute): a new row before it is created (`admit`), a
 * refusal (a malformed body, a missing clip, no code…) as it is answered. Without a token the
 * answer is a 429 `rate_limited` instead, and no row is created; an existing result stays free,
 * even one found only after `admit` (another request made it while the full cap was refreshed):
 * its token is given back.
 */
async function answer(
  request: Request,
  start: (session: Session | null, admit: Admit) => Promise<{ id: string; reused: boolean }>,
) {
  const session = readSession(request);
  let charged = false;

  const charge = () => {
    charged = true;
    const wait = takeToken("generate", requesterKeys(request, session), Date.now());

    return wait === undefined
      ? undefined
      : new GenerateError(
          429,
          `Too many generation requests. Try again in ${wait} s.`,
          "rate_limited",
          wait,
        );
  };

  try {
    const result = await start(session, () => {
      const limited = charge();

      if (limited) {
        throw limited;
      }
    });

    if (charged && result.reused) {
      returnToken("generate", requesterKeys(request, session));
    }

    return Response.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    if (!(error instanceof GenerateError)) {
      throw error;
    }

    const refused = (charged ? undefined : charge()) ?? error;

    return Response.json(
      { error: refused.message, reason: refused.reason, retry_after: refused.retryAfter },
      {
        headers:
          refused.retryAfter === undefined ? {} : { "Retry-After": String(refused.retryAfter) },
        status: refused.status,
      },
    );
  }
}

/**
 * `POST /api/generate` with a JSON `generateInputSchema` body: `generate`, answered by `answer`;
 * 400 for a body that is too large, not JSON, or not the schema.
 */
export function handleGenerate(request: Request, provider: Provider = comfyProvider) {
  return answer(request, async (session, admit) => {
    const body = await readLimitedBody(request, 16_384);

    const input = generateInputSchema.safeParse(
      await new Response(body ?? "").json().catch(() => null),
    );

    if (!input.success) {
      throw new GenerateError(400, z.prettifyError(input.error), "invalid_input");
    }

    return generate(input.data, session, provider, admit);
  });
}

/**
 * `POST /api/generations/:id/retry` and `…/rerun`: `start` (`retry` or `rerun`) for the request's
 * session, answered by `answer`; 400 for a malformed id.
 */
export function startChild(
  request: Request,
  value: string,
  start: (
    id: string,
    session: Session | null,
    provider: Provider,
    admit: Admit,
  ) => Promise<{ id: string; reused: boolean }>,
  provider: Provider = comfyProvider,
) {
  return answer(request, (session, admit) => {
    const id = z.uuid().safeParse(value);

    if (!id.success) {
      throw new GenerateError(400, "Invalid generation ID");
    }

    return start(id.data, session, provider, admit);
  });
}

/** A route's `:generationId` as a UUID, or the 400 response for a malformed one. */
export function generationIdParam(value: string) {
  const id = z.uuid().safeParse(value);

  return id.success ? id.data : Response.json({ error: "Invalid generation ID" }, { status: 400 });
}
