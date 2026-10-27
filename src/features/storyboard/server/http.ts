// The storyboard feature's HTTP handlers, mounted by the thin routes `src/routes/api.storyboards*.ts`.
// Every one needs an access-code session (the access guard answers 401 before them; they check
// again so a direct call is refused the same way). A failed card or split is retried with the
// shared `POST /api/generations/:id/retry`, or a card rendered again here.
import { z } from "zod";

import { readJsonBody, readSession, type Session } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { answer, readInput } from "../../../shared/server/generation/http.ts";
import type { Admit } from "../../../shared/server/generation/service.ts";
import {
  createStoryboardInputSchema,
  generateCardsInputSchema,
  saveStoryboardInputSchema,
  type Storyboard,
} from "../contracts.ts";
import {
  createStoryboard,
  generateCards,
  listWorkspaceStoryboards,
  readStoryboard,
  saveStoryboardText,
} from "./storyboards.ts";

// A body holds at most four descriptions of 1000 characters, a sequence and a title.
const BODY_LIMIT = 32_768;

const accessRequired = () =>
  Response.json(
    { error: "Enter an access code to do this.", reason: "access_required" },
    { status: 401 },
  );

const invalidId = () =>
  Response.json({ error: "Invalid storyboard ID", reason: "invalid_input" }, { status: 400 });

const notFound = () =>
  Response.json({ error: "Storyboard not found.", reason: "not_found" }, { status: 404 });

type Admitted = { created: boolean; storyboard: Storyboard | null };

/**
 * Answers a request that may admit generations through the shared `answer` (the rate limit, and
 * a refusal's status with `{ error, reason }`), then with the storyboard: 201 when the request
 * made or rendered something now, 200 when its request key had done so before (nothing stored).
 * The body's `request_key` is required, so asking again cannot admit anything twice.
 */
async function answerAdmitted<Input>(
  request: Request,
  schema: z.ZodType<Input>,
  start: (
    input: Input,
    submission: { admit: Admit; requestKey: string; session: Session | null },
  ) => Admitted,
) {
  let result: Admitted | undefined;

  const response = await answer(request, async (session, admit) => {
    const { input, requestKey } = await readInput(request, schema, BODY_LIMIT);

    if (!requestKey) {
      throw new GenerateError(
        400,
        "A storyboard request needs a request_key (a UUID), so asking again cannot admit it twice.",
        "invalid_input",
      );
    }

    result = start(input, { admit, requestKey, session });

    if (!result.storyboard) {
      throw new Error("An admitted storyboard was not stored");
    }

    // What `answer` needs to know: an earlier answer is a reused one (its token goes back).
    return { id: result.storyboard.id, reused: !result.created };
  });

  return result
    ? Response.json(result.storyboard, { status: result.created ? 201 : 200 })
    : response;
}

/**
 * `POST /api/storyboards` with a JSON `createStoryboardInputSchema` body and its `request_key`:
 * `createStoryboard`. 201 with the storyboard (`storyboardSchema`) made now, 200 with the one the
 * key made before; 400 `invalid_input`, 401, 403 `code_exhausted` (the split does not fit the
 * code; nothing stored), 404 `character_not_found`, 409 `request_key_conflict`, 429, 503
 * `queue_full`.
 */
export function handleCreateStoryboard(request: Request, provider: Provider = comfyProvider) {
  return answerAdmitted(request, createStoryboardInputSchema, (input, submission) =>
    createStoryboard(input, { ...submission, provider }),
  );
}

/**
 * `POST /api/storyboards/:id/generations` with a JSON `generateCardsInputSchema` body and its
 * `request_key`: `generateCards`. 201 with the storyboard, its named cards rendering; 200 with
 * it as it is for a key it used before; 400, 401, 403 `code_exhausted`, 404, 409
 * `request_key_conflict`, 422 for a named card without a description, 429, 503 `queue_full`.
 */
export function handleGenerateCards(
  request: Request,
  value: string,
  provider: Provider = comfyProvider,
) {
  const id = z.uuid().safeParse(value);

  if (!id.success) {
    return invalidId();
  }

  return answerAdmitted(request, generateCardsInputSchema, (input, submission) =>
    generateCards(id.data, input, { ...submission, provider }),
  );
}

/** `GET /api/storyboards`: `storyboardListSchema`; 401 without a session. */
export function handleListStoryboards(request: Request) {
  return readSession(request) ? Response.json(listWorkspaceStoryboards()) : accessRequired();
}

/** `GET /api/storyboards/:id`: `storyboardSchema`; 400 malformed id, 401, 404. */
export function handleReadStoryboard(request: Request, value: string) {
  if (!readSession(request)) {
    return accessRequired();
  }

  const id = z.uuid().safeParse(value);

  if (!id.success) {
    return invalidId();
  }

  const storyboard = readStoryboard(id.data);

  return storyboard ? Response.json(storyboard) : notFound();
}

/**
 * `PUT /api/storyboards/:id` with a JSON `saveStoryboardInputSchema` body: saves the title,
 * style and descriptions (`saveStoryboardText`); 200 with the storyboard, 400, 401, 404. Renders
 * nothing, so it takes no request key and no rate-limit token.
 */
export async function handleSaveStoryboard(request: Request, value: string) {
  if (!readSession(request)) {
    return accessRequired();
  }

  const id = z.uuid().safeParse(value);

  if (!id.success) {
    return invalidId();
  }

  const body = await readJsonBody(request, saveStoryboardInputSchema, BODY_LIMIT);

  if (body.error !== undefined) {
    return Response.json({ error: body.error, reason: "invalid_input" }, { status: 400 });
  }

  try {
    return Response.json(saveStoryboardText(id.data, body.data));
  } catch (error) {
    if (error instanceof GenerateError && error.status === 404) {
      return notFound();
    }

    throw error;
  }
}
