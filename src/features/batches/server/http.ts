// The batches feature's HTTP handlers, mounted by the thin routes `src/routes/api.batches*.ts`.
// Every one needs an access-code session (the access guard answers 401 before them; they check
// again so a direct call is refused the same way). A retry is the shared one,
// `POST /api/generations/:id/retry`, on the item's current generation.
import { z } from "zod";

import { readSession } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import type {
  WorkflowDefinition,
  WorkflowRecipe,
} from "../../../shared/server/generation/definition.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { answer, readInput } from "../../../shared/server/generation/http.ts";
import { type Batch, createBatchInputSchema } from "../contracts.ts";
import { createBatch, listWorkspaceBatches, readBatch } from "./batches.ts";

const accessRequired = () =>
  Response.json(
    { error: "Enter an access code to do this.", reason: "access_required" },
    { status: 401 },
  );

/**
 * `POST /api/batches` with a JSON `createBatchInputSchema` body and its `request_key` (a UUID,
 * required): `createBatch` for the request's session, through the generation service's request
 * answer (`answer`: the rate limit, and the refusal's status with `{ error, reason }`). 201 with
 * the batch (`batchSchema`) admitted now, 200 with the batch the key admitted before; 400
 * `invalid_input` for a body that is too large, not JSON, not the schema or without a key; 401,
 * 403 `code_exhausted` (nothing stored), 404/422 for an item the workflow refuses (nothing
 * stored), 409 `request_key_conflict`, 429, 503 `queue_full`.
 */
export async function handleCreateBatch<Input, Recipe extends WorkflowRecipe>(
  request: Request,
  definition: WorkflowDefinition<Input, Recipe>,
  provider: Provider = comfyProvider,
) {
  let admitted: { batch: Batch | null; created: boolean } | undefined;

  const response = await answer(request, async (session, admit) => {
    const { input, requestKey } = await readInput(request, createBatchInputSchema, 16_384);

    if (!requestKey) {
      throw new GenerateError(
        400,
        "A batch request needs a request_key (a UUID), so asking again cannot admit it twice.",
        "invalid_input",
      );
    }

    admitted = createBatch(definition, input, { admit, provider, requestKey, session });

    const first = admitted.batch?.items[0];

    if (!first) {
      throw new Error("An admitted batch has no item");
    }

    // What `answer` needs to know: an existing batch is a reused answer (its token goes back).
    return { id: first.generation.id, reused: !admitted.created };
  });

  return admitted
    ? Response.json(admitted.batch, { status: admitted.created ? 201 : 200 })
    : response;
}

/** `GET /api/batches`: `batchListSchema`; 401 without a session. */
export function handleListBatches(request: Request) {
  const session = readSession(request);

  if (!session) {
    return accessRequired();
  }

  try {
    return Response.json(listWorkspaceBatches(session));
  } catch (error) {
    if (!(error instanceof GenerateError)) {
      throw error;
    }

    return Response.json({ error: error.message, reason: error.reason }, { status: error.status });
  }
}

/**
 * `GET /api/batches/:id`: the batch with each item's current generation (`batchSchema`); 400 for
 * a malformed id, 401 without a session, 404 for an unknown one.
 */
export function handleReadBatch(request: Request, value: string) {
  if (!readSession(request)) {
    return accessRequired();
  }

  const id = z.uuid().safeParse(value);

  if (!id.success) {
    return Response.json({ error: "Invalid batch ID" }, { status: 400 });
  }

  const batch = readBatch(id.data);

  return batch
    ? Response.json(batch)
    : Response.json({ error: "Batch not found.", reason: "not_found" }, { status: 404 });
}
