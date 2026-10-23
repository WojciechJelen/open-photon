import type { Session } from "../../../shared/server/access.server.ts";
import { readJsonBody } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { findGeneration } from "../../../shared/server/generation/generations.ts";
import { answer, generationIdParam, readInput } from "../../../shared/server/generation/http.ts";
import { type Admit, submit } from "../../../shared/server/generation/service.ts";
import { CharacterError, createFromGeneration } from "../../characters/api.ts";
import {
  CHARACTER_GENERATION_WORKFLOW,
  type CharacterCaptionInput,
  type CharacterGenerationInput,
  IMAGE_OUTPUT,
  saveCharacterInputSchema,
} from "../contracts.ts";
import { characterCaptionDefinition } from "../workflows/caption-definition.ts";
import { characterGenerationDefinition } from "../workflows/definition.ts";

/** How the service is reached: the provider, the rate-limit admission and the client's key. */
type Submission = { admit?: Admit; provider?: Provider; requestKey?: string };

/**
 * Starts a caption enhancement (`characterCaptionDefinition`) for `session` through the
 * generation service. A generation with the same recipe that is done or on its way is returned
 * instead (`reused`); with the client's `requestKey`, the same request again returns the
 * generation the first one made. Without a session it is refused like any paid generation.
 */
export function enhanceCaption(
  input: CharacterCaptionInput,
  session: Session | null,
  { admit, provider = comfyProvider, requestKey }: Submission = {},
) {
  return submit(characterCaptionDefinition, input, {
    admit,
    provider,
    requestKey,
    scope: { free: () => false, session },
  });
}

/**
 * Starts a character image (`characterGenerationDefinition`) for `session`, as `enhanceCaption`
 * does. With `source.caption_generation_id`, the caption's provenance is copied from that done
 * caption enhancement (refused with its `GenerateError` otherwise) and nothing is enhanced again.
 */
export function generateCharacter(
  input: CharacterGenerationInput,
  session: Session | null,
  { admit, provider = comfyProvider, requestKey }: Submission = {},
) {
  return submit(characterGenerationDefinition, input, {
    admit,
    provider,
    requestKey,
    scope: { free: () => false, session },
  });
}

/**
 * `POST /api/character-captions` with a JSON `characterCaptionInputSchema` body and an optional
 * `request_key` (a UUID): `enhanceCaption`, answered by the shared `answer` (201, 202 waiting, 200
 * reused, the `GenerateError` statuses, 429 `rate_limited`); 400 `invalid_input` for a body that is
 * too large, not JSON, or not the schema. The caption arrives as the text output `caption` of
 * `GET /api/generations/:id`.
 */
export function handleCharacterCaption(request: Request, provider: Provider = comfyProvider) {
  return answer(request, async (session, admit) => {
    const { input, requestKey } = await readInput(
      request,
      characterCaptionDefinition.inputSchema,
      16_384,
    );

    return enhanceCaption(input, session, { admit, provider, requestKey });
  });
}

/**
 * `POST /api/character-generations` with a JSON `characterGenerationInputSchema` body and an
 * optional `request_key`: `generateCharacter`, answered as `handleCharacterCaption` is, plus 404
 * `caption_not_found`, 409 `not_caption` and 409 `caption_not_done` for a
 * `source.caption_generation_id` that is no done caption enhancement.
 */
export function handleCharacterGeneration(request: Request, provider: Provider = comfyProvider) {
  return answer(request, async (session, admit) => {
    const { input, requestKey } = await readInput(
      request,
      characterGenerationDefinition.inputSchema,
      32_768,
    );

    return generateCharacter(input, session, { admit, provider, requestKey });
  });
}

/**
 * `POST /api/character-generations/:generationId/character` with a JSON body `{ title? }`
 * (`saveCharacterInputSchema`, at most 4 KiB; `{}` for no title): saves the `image` output
 * of a done character generation to the workspace library, the user's explicit action
 * (`createFromGeneration` of the characters API, which takes the prompt and provenance from the
 * stored recipe). 201 with the new `CharacterSummary`, 200 with the one already saved from it; 400
 * `invalid_input` for a malformed id, or a body that is missing, too large, not JSON or not the
 * schema (like `readInput`: nothing is saved then), 404 `not_found` for no such generation, 409
 * `not_character_generation` for a generation of another workflow, then the characters API's
 * refusals (409 `not_done`, 422 `invalid_title`, …). Not public: the access guard answers 401
 * without a session.
 */
export async function handleSaveCharacter(request: Request, generationId: string) {
  const id = generationIdParam(generationId);

  if (id instanceof Response) {
    return id;
  }

  const body = await readJsonBody(request, saveCharacterInputSchema, 4096);

  if (body.error !== undefined) {
    return Response.json({ error: body.error, reason: "invalid_input" }, { status: 400 });
  }

  const generation = findGeneration(id);

  if (!generation) {
    return Response.json({ error: "Generation not found.", reason: "not_found" }, { status: 404 });
  }

  if (generation.workflow_id !== CHARACTER_GENERATION_WORKFLOW) {
    return Response.json(
      {
        error: "Only a character generation's image can be saved here.",
        reason: "not_character_generation",
      },
      { status: 409 },
    );
  }

  try {
    const { character, created } = createFromGeneration({
      generationId: id,
      outputName: IMAGE_OUTPUT,
      title: body.data.title,
    });

    return Response.json(character, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof CharacterError) {
      return Response.json(
        { error: error.message, reason: error.reason },
        { status: error.status },
      );
    }

    throw error;
  }
}
