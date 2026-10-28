import type { Session } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { answer, readInput } from "../../../shared/server/generation/http.ts";
import { type Admit, submit } from "../../../shared/server/generation/service.ts";
import type { AnimateImageInput } from "../contracts.ts";
import { animateImageDefinition } from "../workflows/definition.ts";

/**
 * Starts an animation (`animateImageDefinition`) for `session` through the generation service.
 * A generation with the same recipe that is done or on its way is returned instead (`reused`);
 * with the client's `requestKey`, the same request again returns the generation the first one
 * made, even though its seed was drawn at random. Without a session it is refused like any paid
 * generation.
 */
export function animateImage(
  input: AnimateImageInput,
  session: Session | null,
  {
    admit,
    provider = comfyProvider,
    requestKey,
  }: { admit?: Admit; provider?: Provider; requestKey?: string } = {},
) {
  return submit(animateImageDefinition, input, {
    admit,
    provider,
    requestKey,
    scope: { free: () => false, session },
  });
}

/**
 * `POST /api/animations` with a JSON `animateImageInputSchema` body and an optional
 * `request_key`: `animateImage`, answered by the shared `answer` (201, 202 waiting, 200 reused,
 * 429 `rate_limited`, the `GenerateError` statuses of the definition's source checks); 400
 * `invalid_input` for a body that is too large, not JSON, or not the schema. Progress, the
 * video, retry and the share page are the shared generation routes'.
 */
export function handleAnimation(request: Request, provider: Provider = comfyProvider) {
  return answer(request, async (session, admit) => {
    const { input, requestKey } = await readInput(
      request,
      animateImageDefinition.inputSchema,
      8192,
    );

    return animateImage(input, session, { admit, provider, requestKey });
  });
}
