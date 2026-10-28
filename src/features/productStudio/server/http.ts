// Product Studio's HTTP handlers, mounted by the thin routes `src/routes/api.product-shots*.ts`.
// Every one needs an access-code session (the access guard answers 401 before them; they check
// again so a direct call is refused the same way). Uploading the product photo is the shared
// `POST /api/image-uploads`; retrying a shot is the shared `POST /api/generations/:id/retry`.
import { z } from "zod";

import { readSession } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { answer, readInput } from "../../../shared/server/generation/http.ts";
import { createShootInputSchema, type Shoot } from "../contracts.ts";
import { createShoot, listWorkspaceShoots, readShoot } from "./shoots.ts";

const accessRequired = () =>
  Response.json(
    { error: "Enter an access code to do this.", reason: "access_required" },
    { status: 401 },
  );

/**
 * `POST /api/product-shots` with a JSON `createShootInputSchema` body and its `request_key` (a
 * UUID, required): `createShoot` for the request's session, through the generation service's
 * request answer (`answer`: the rate limit, and a refusal's status with `{ error, reason }`). 201
 * with the shoot (`shootSchema`) admitted now, 200 with the shoot the key admitted before; 400
 * `invalid_input` for a body that is too large, not JSON, not the schema or without a key; 401,
 * 403 `code_exhausted` (nothing stored), 404 `not_found` for a product photo that is not a stored
 * image (nothing stored), 409 `request_key_conflict`, 429, 503 `queue_full`.
 */
export async function handleCreateShoot(request: Request, provider: Provider = comfyProvider) {
  let admitted: { created: boolean; shoot: Shoot | null } | undefined;

  const response = await answer(request, async (session, admit) => {
    const { input, requestKey } = await readInput(request, createShootInputSchema, 8192);

    if (!requestKey) {
      throw new GenerateError(
        400,
        "A shoot request needs a request_key (a UUID), so asking again cannot admit it twice.",
        "invalid_input",
      );
    }

    admitted = createShoot(input, { admit, provider, requestKey, session });

    const first = admitted.shoot?.items[0];

    if (!first) {
      throw new Error("An admitted shoot has no shot");
    }

    // What `answer` needs to know: an existing shoot is a reused answer (its token goes back).
    return { id: first.generation.id, reused: !admitted.created };
  });

  return admitted
    ? Response.json(admitted.shoot, { status: admitted.created ? 201 : 200 })
    : response;
}

/** `GET /api/product-shots`: `shootListSchema`; 401 without a session. */
export function handleListShoots(request: Request) {
  return readSession(request) ? Response.json(listWorkspaceShoots()) : accessRequired();
}

/**
 * `GET /api/product-shots/:id`: the shoot with each shot's current generation (`shootSchema`);
 * 401 without a session, 404 `not_found` for an id that names no shoot (a malformed one too).
 */
export function handleReadShoot(request: Request, value: string) {
  if (!readSession(request)) {
    return accessRequired();
  }

  const shoot = z.uuid().safeParse(value).success ? readShoot(value) : null;

  return shoot
    ? Response.json(shoot)
    : Response.json({ error: "Shoot not found.", reason: "not_found" }, { status: 404 });
}
