// Shots & Angles' HTTP handlers, mounted by the thin routes `src/routes/api.angle-sets*.ts`. Every
// one needs an access-code session (the access guard answers 401 before them; they check again so
// a direct call is refused the same way). A view's retry is the shared one,
// `POST /api/generations/:id/retry`, on its current generation.
import { z } from "zod";

import { readJsonBody, readSession } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { answer, readInput } from "../../../shared/server/generation/http.ts";
import { CharacterError } from "../../characters/api.ts";
import { type AngleSet, createAngleSetInputSchema, saveViewInputSchema } from "../contracts.ts";
import { createAngleSet, listAngleSets, readAngleSet, saveView } from "./angle-sets.ts";

const refusal = (status: number, error: string, reason: string) =>
  Response.json({ error, reason }, { status });

const accessRequired = () => refusal(401, "Enter an access code to do this.", "access_required");

/**
 * `POST /api/angle-sets` with a JSON `createAngleSetInputSchema` body and its `request_key` (a
 * UUID, required): `createAngleSet` for the request's session, through the generation service's
 * request answer (`answer`: the rate limit, and a refusal's status with `{ error, reason }`). 201
 * with the set (`angleSetSchema`) admitted now, 200 with the set the key admitted before; 400
 * `invalid_input` for a body that is too large, not JSON, not the schema or without a key; 401,
 * 403 `code_exhausted` (its new views do not fit the code; nothing stored), 404/422 for a
 * character the workflow refuses (nothing stored), 409 `request_key_conflict`, 429, 503.
 */
export async function handleCreateAngleSet(request: Request, provider: Provider = comfyProvider) {
  let admitted: { created: boolean; set: AngleSet | null } | undefined;

  const response = await answer(request, async (session, admit) => {
    const { input, requestKey } = await readInput(request, createAngleSetInputSchema, 4096);

    if (!requestKey) {
      throw new GenerateError(
        400,
        "An angle set request needs a request_key (a UUID), so asking again cannot admit it twice.",
        "invalid_input",
      );
    }

    admitted = createAngleSet(input, { admit, provider, requestKey, session });

    const first = admitted.set?.items[0];

    if (!first) {
      throw new Error("An admitted angle set has no view");
    }

    // What `answer` needs to know: an existing set is a reused answer (its token goes back).
    return { id: first.generation.id, reused: !admitted.created };
  });

  return admitted
    ? Response.json(admitted.set, { status: admitted.created ? 201 : 200 })
    : response;
}

/** `GET /api/angle-sets`: `angleSetListSchema`; 401 without a session. */
export function handleListAngleSets(request: Request) {
  return readSession(request) ? Response.json(listAngleSets()) : accessRequired();
}

/**
 * `GET /api/angle-sets/:id`: the set with each view's current generation (`angleSetSchema`); 400
 * for a malformed id, 401 without a session, 404 for an unknown one.
 */
export function handleReadAngleSet(request: Request, value: string) {
  if (!readSession(request)) {
    return accessRequired();
  }

  const id = z.uuid().safeParse(value);

  if (!id.success) {
    return refusal(400, "Invalid angle set ID", "invalid_input");
  }

  const set = readAngleSet(id.data);

  return set ? Response.json(set) : refusal(404, "Angle set not found.", "not_found");
}

/**
 * `POST /api/angle-sets/:id/items/:position/character` with a JSON body `{ title? }`
 * (`saveViewInputSchema`, at most 4 KiB; `{}` for no title): saves that view's current image to
 * the workspace library (`saveView`), the user's explicit action. 201 with the new
 * `CharacterSummary`, 200 with the one already saved from it; 400 `invalid_input` for a malformed
 * id or position or a body that is missing, too large, not JSON or not the schema (nothing is
 * saved), 401, 404 `not_found`, then the characters API's refusals (409 `not_done`, …).
 */
export async function handleSaveView(request: Request, setId: string, position: string) {
  if (!readSession(request)) {
    return accessRequired();
  }

  const params = z
    .object({ position: z.coerce.number().int().nonnegative(), setId: z.uuid() })
    .safeParse({ position, setId });

  if (!params.success) {
    return refusal(400, "Invalid angle set ID or view position", "invalid_input");
  }

  const body = await readJsonBody(request, saveViewInputSchema, 4096);

  if (body.error !== undefined) {
    return refusal(400, body.error, "invalid_input");
  }

  try {
    const { character, created } = saveView(
      params.data.setId,
      params.data.position,
      body.data.title,
    );

    return Response.json(character, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof CharacterError) {
      return refusal(error.status, error.message, error.reason);
    }

    throw error;
  }
}
