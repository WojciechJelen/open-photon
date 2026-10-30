// Sprite Forge's HTTP handlers, mounted by the thin routes `src/routes/api.sprite-sets*.ts`. Every
// one needs an access-code session (the access guard answers 401 before them; they check again so
// a direct call is refused the same way). A view's or sheet's retry is the shared one,
// `POST /api/generations/:id/retry`, on its current generation.
import { z } from "zod";

import { readSession, type Session } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { answer, readInput } from "../../../shared/server/generation/http.ts";
import type { Admit } from "../../../shared/server/generation/service.ts";
import { createSpriteSetInputSchema, createSpriteSheetInputSchema } from "../contracts.ts";
import {
  createSpriteSet,
  createSpriteSheet,
  listSpriteSets,
  readSpriteSet,
} from "./sprite-sets.ts";

// The largest JSON body an admission reads: a few ids and options.
const BODY_LIMIT = 4096;

const refusal = (status: number, error: string, reason: string) =>
  Response.json({ error, reason }, { status });

const accessRequired = () => refusal(401, "Enter an access code to do this.", "access_required");

/** What an admission stored or found again: the body to answer, and the generation it names. */
type Admitted = { body: unknown; created: boolean; generationId: string };

/**
 * An admission request through the generation service's request answer (`answer`: the rate
 * limit, and a refusal's status with `{ error, reason }`): the body as `schema` with its required
 * `request_key` (400 `invalid_input` without one, so asking again cannot admit twice), then
 * `admitInput`. 201 with the admitted body, 200 with the one the key admitted before (its rate
 * token goes back, as for any reused answer).
 */
async function answerAdmission<Input>(
  request: Request,
  schema: z.ZodType<Input>,
  admitInput: (
    input: Input,
    options: { admit: Admit; requestKey: string; session: Session | null },
  ) => Admitted,
) {
  let admitted: Admitted | undefined;

  const response = await answer(request, async (session, admit) => {
    const { input, requestKey } = await readInput(request, schema, BODY_LIMIT);

    if (!requestKey) {
      throw new GenerateError(
        400,
        "Send a request_key (a UUID) with this request, so asking again cannot admit it twice.",
        "invalid_input",
      );
    }

    admitted = admitInput(input, { admit, requestKey, session });

    return { id: admitted.generationId, reused: !admitted.created };
  });

  return admitted
    ? Response.json(admitted.body, { status: admitted.created ? 201 : 200 })
    : response;
}

/**
 * `POST /api/sprite-sets` with a JSON `createSpriteSetInputSchema` body and its `request_key`:
 * `createSpriteSet` for the request's session. 201 with the set (`spriteSetSchema`) admitted now,
 * 200 with the set the key admitted before; 400 `invalid_input`, 401, 403 `code_exhausted` (its
 * new views do not fit the code; nothing stored), 404 for a character the workflow refuses
 * (nothing stored), 409 `request_key_conflict`, 429, 503.
 */
export function handleCreateSpriteSet(request: Request, provider: Provider = comfyProvider) {
  return answerAdmission(request, createSpriteSetInputSchema, (input, options) => {
    const { created, set } = createSpriteSet(input, { ...options, provider });
    const generationId = set?.views[0]?.generation.id;

    if (!generationId) {
      throw new Error("An admitted sprite set has no view");
    }

    return { body: set, created, generationId };
  });
}

/** `GET /api/sprite-sets`: `spriteSetListSchema`; 401 without a session. */
export function handleListSpriteSets(request: Request) {
  return readSession(request) ? Response.json(listSpriteSets()) : accessRequired();
}

/**
 * `GET /api/sprite-sets/:id`: the set with each view's and sheet's current generation
 * (`spriteSetSchema`); 400 for a malformed id, 401 without a session, 404 for an unknown one.
 */
export function handleReadSpriteSet(request: Request, value: string) {
  if (!readSession(request)) {
    return accessRequired();
  }

  const id = z.uuid().safeParse(value);

  if (!id.success) {
    return refusal(400, "Invalid sprite set ID", "invalid_input");
  }

  const set = readSpriteSet(id.data);

  return set ? Response.json(set) : refusal(404, "Sprite set not found.", "not_found");
}

/**
 * `POST /api/sprite-sets/:id/sheets` with a JSON `createSpriteSheetInputSchema` body and its
 * `request_key`: `createSpriteSheet` for the request's session. 201 with `{ set, sheet }`
 * (`createdSpriteSheetSchema`) admitted now, 200 with the sheet the key admitted before; 400
 * `invalid_input` (also for a malformed set id), 401, 403 `code_exhausted`, 404 `not_found`, 409
 * `views_not_done` or `request_key_conflict`, 422 `selfhost_required` on a Comfy Cloud target,
 * 429, 503. Any refusal stores nothing.
 */
export function handleCreateSpriteSheet(
  request: Request,
  value: string,
  provider: Provider = comfyProvider,
) {
  return answerAdmission(request, createSpriteSheetInputSchema, (input, options) => {
    const setId = z.uuid().safeParse(value);

    if (!setId.success) {
      throw new GenerateError(400, "Invalid sprite set ID", "invalid_input");
    }

    const { created, set, sheet } = createSpriteSheet(setId.data, input, {
      ...options,
      provider,
    });

    return { body: { set, sheet }, created, generationId: sheet.generation.id };
  });
}
