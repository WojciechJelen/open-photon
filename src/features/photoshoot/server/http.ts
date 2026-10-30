// The photoshoot feature's HTTP handlers, mounted by the thin routes `src/routes/api.photoshoots*.ts`.
// Every one needs an access-code session (the access guard answers 401 before them; they check
// again so a direct call is refused the same way). A retry is the shared one,
// `POST /api/generations/:id/retry`, on the shot's current generation.
import { z } from "zod";

import { readJsonBody, readSession } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { answer, readInput } from "../../../shared/server/generation/http.ts";
import { CharacterError } from "../../characters/api.ts";
import {
  createPhotoshootInputSchema,
  type Photoshoot,
  savePhotoshootResultSchema,
} from "../contracts.ts";
import {
  createPhotoshoot,
  listWorkspacePhotoshoots,
  readPhotoshoot,
  saveShot,
} from "./photoshoots.ts";

const refused = (error: { message: string; reason?: string; status: number }) =>
  Response.json({ error: error.message, reason: error.reason }, { status: error.status });

const accessRequired = () =>
  refused({ message: "Enter an access code to do this.", reason: "access_required", status: 401 });

/**
 * `POST /api/photoshoots` with a JSON `createPhotoshootInputSchema` body and its `request_key`
 * (a UUID, required): `createPhotoshoot` for the request's session, through the generation
 * service's request answer (`answer`: the rate limit, and a refusal's status with
 * `{ error, reason }`). 201 with the photoshoot (`photoshootSchema`) admitted now, 200 with the
 * one the key admitted before; 400 `invalid_input`, 401, 403 `code_exhausted` (nothing stored),
 * 404 `character_not_found`, 409 `request_key_conflict`, 429, 503 `queue_full`.
 */
export async function handleCreatePhotoshoot(request: Request, provider: Provider = comfyProvider) {
  let admitted: { created: boolean; photoshoot: Photoshoot | null } | undefined;

  const response = await answer(request, async (session, admit) => {
    const { input, requestKey } = await readInput(request, createPhotoshootInputSchema, 4096);

    if (!requestKey) {
      throw new GenerateError(
        400,
        "A photoshoot request needs a request_key (a UUID), so asking again cannot admit it twice.",
        "invalid_input",
      );
    }

    admitted = createPhotoshoot(input, session, { admit, provider, requestKey });

    const first = admitted.photoshoot?.items[0];

    if (!first) {
      throw new Error("An admitted photoshoot has no shot");
    }

    // What `answer` needs to know: an existing photoshoot is a reused answer (its token goes back).
    return { id: first.generation.id, reused: !admitted.created };
  });

  return admitted
    ? Response.json(admitted.photoshoot, { status: admitted.created ? 201 : 200 })
    : response;
}

/** `GET /api/photoshoots`: `photoshootListSchema`; 401 without a session. */
export function handleListPhotoshoots(request: Request) {
  return readSession(request) ? Response.json(listWorkspacePhotoshoots()) : accessRequired();
}

/**
 * The photoshoot id a path names, for a request with a session: else the refusal to answer with
 * (401 `access_required`, 400 `not_found` for a malformed id: no photoshoot has it).
 */
function photoshootIdOf(request: Request, value: string): string | Response {
  const id = z.uuid().safeParse(value);

  if (!readSession(request)) {
    return accessRequired();
  }

  return id.success
    ? id.data
    : refused({ message: "Invalid photoshoot ID", reason: "not_found", status: 400 });
}

/** `GET /api/photoshoots/:id`: `photoshootSchema`; 400 `not_found` malformed id, 401, 404. */
export function handleReadPhotoshoot(request: Request, value: string) {
  const id = photoshootIdOf(request, value);

  if (id instanceof Response) {
    return id;
  }

  const photoshoot = readPhotoshoot(id);

  return photoshoot
    ? Response.json(photoshoot)
    : refused({ message: "Photoshoot not found.", reason: "not_found", status: 404 });
}

/**
 * `POST /api/photoshoots/:id/character` with a JSON `savePhotoshootResultSchema` body: saves the
 * image of one of the photoshoot's current, done generations to the workspace library
 * (`createFromGeneration`, the user's explicit action). 201 with the new `CharacterSummary`, 200
 * with the one already saved from it; 400 `invalid_input` (nothing saved), 401, 404 for an
 * unknown photoshoot or a generation none of its shots has, the characters API's refusals
 * (409 `not_done`, …).
 */
export async function handleSaveShot(request: Request, value: string) {
  const id = photoshootIdOf(request, value);

  if (id instanceof Response) {
    return id;
  }

  const body = await readJsonBody(request, savePhotoshootResultSchema, 4096);

  if (body.error !== undefined) {
    return Response.json({ error: body.error, reason: "invalid_input" }, { status: 400 });
  }

  try {
    const { character, created } = saveShot(id, body.data.generation_id, body.data.title);

    return Response.json(character, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof CharacterError || error instanceof GenerateError) {
      return refused(error);
    }

    throw error;
  }
}
