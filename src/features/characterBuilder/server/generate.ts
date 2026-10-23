import type { Session } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { answer, readInput } from "../../../shared/server/generation/http.ts";
import { type Admit, submit } from "../../../shared/server/generation/service.ts";
import type { CharacterGenerationInput } from "../contracts.ts";
import { characterGenerationDefinition } from "../workflows/definition.ts";

/**
 * Starts a character generation (`characterGenerationDefinition`) for `session` through the
 * generation service (`submit`). A generation with the same recipe that is done or still on its
 * way is returned instead (`reused`); there are no free pre-rendered ones, so without a session
 * it is refused like any paid generation. With the client's `requestKey`, the same request again
 * returns the generation the first one made, even with a seed drawn at random.
 */
export function generateCharacter(
  input: CharacterGenerationInput,
  session: Session | null,
  provider: Provider = comfyProvider,
  admit?: Admit,
  requestKey?: string,
) {
  return submit(characterGenerationDefinition, input, {
    admit,
    provider,
    requestKey,
    scope: { free: () => false, session },
  });
}

/**
 * `POST /api/character-generations` with a JSON `characterGenerationInputSchema` body and an
 * optional `request_key` (a UUID): `generateCharacter`, answered by `answer` as
 * `POST /api/generate` is (201 `{ id, reused: false }`, 202 `{ id, reused: false, status:
 * "waiting", position }` in line, 200 `{ id, reused: true }`, the `GenerateError` statuses, 429
 * `rate_limited`); 400 for a body that is too large, not JSON, or not the schema. Status and
 * progress come from the shared `GET /api/generations/:id` and `/events`.
 */
export function handleCharacterGeneration(request: Request, provider: Provider = comfyProvider) {
  return answer(request, async (session, admit) => {
    const { input, requestKey } = await readInput(
      request,
      characterGenerationDefinition.inputSchema,
      16_384,
    );

    return generateCharacter(input, session, provider, admit, requestKey);
  });
}
