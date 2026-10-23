import { z } from "zod";

import { generationSchema } from "../../../shared/contracts.ts";
import type { Session } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import {
  findGeneration as findStoredGeneration,
  readOutputs,
} from "../../../shared/server/generation/generations.ts";
import { answer, readInput } from "../../../shared/server/generation/http.ts";
import { type Admit, settleAbandoned, submit } from "../../../shared/server/generation/service.ts";
import { getCharacter, visibleCharacter } from "../../characters/api.ts";
import type { GenerateInput } from "../contracts.ts";
import { motionTransferDefinition } from "../workflows/definition.ts";
import { asMotionTransfer, findGeneration } from "./generations.ts";
import { directionOf } from "./selection.ts";
import { sampleMotionTitle, sourceClip } from "./shot.ts";

/**
 * `POST /api/generate` (`handleGenerate`): the input contract is `generateInputSchema`, the
 * recipe `motionTransferDefinition`'s, submitted through the generation service (`submit`). A
 * generation with the same recipe that is done or still on its way is returned instead
 * (`reused`). Without a session (`session` is `null`) it answers only with a done pre-rendered
 * sample generation of the same recipe, the free sample × sample lookup.
 */
export function generate(
  input: GenerateInput,
  session: Session | null,
  provider: Provider = comfyProvider,
  admit?: Admit,
) {
  return submit(motionTransferDefinition, input, {
    admit,
    provider,
    scope: { free: (existing) => existing.status === "done" && existing.is_prerendered, session },
  });
}

/**
 * `POST /api/generate` with a JSON `generateInputSchema` body: `generate`, answered by `answer`;
 * 400 for a body that is too large, not JSON, or not the schema.
 */
export function handleGenerate(request: Request, provider: Provider = comfyProvider) {
  return answer(request, async (session, admit) =>
    generate(
      await readInput(request, motionTransferDefinition.inputSchema, 16_384),
      session,
      provider,
      admit,
    ),
  );
}

/**
 * What `/g/:id` shows of a Motion Transfer generation: the generation as stored (a `preparing`
 * row a stopped server left is settled first), its recipe, its named outputs once done
 * (`outputs`; the result and its poster as `final` and `poster`), the motion clip it was made
 * from (`source`, the asset the wizard's `?motion=` names) with its sample title if it is one
 * (`motionTitle`), the character with its image as `signedIn` may see it (`visibleCharacter`),
 * the direction it was made with (`directionOf`, for the take's draft) and, for a child, whether
 * it kept its parent's seed (a re-run) or not (a retry); `null` for a
 * malformed or unknown id, or another workflow's generation. It never asks Comfy, so the page
 * renders at once even when Comfy does not answer: the page's event stream finalizes a row Comfy
 * has finished, as `GET /api/generations/:id` does.
 */
export function readResult(id: string, signedIn: boolean) {
  const parsed = z.uuid().safeParse(id);
  const stored = parsed.success ? findStoredGeneration(parsed.data) : null;
  const row = asMotionTransfer(stored && settleAbandoned(stored));

  if (!row) {
    return null;
  }

  const source = sourceClip(row);
  const parent = row.parent_id ? findGeneration(row.parent_id) : null;
  const character = row.character_id ? getCharacter(row.character_id) : null;
  const outputs = row.status === "done" ? readOutputs(row.id) : [];

  return {
    character: visibleCharacter(character, signedIn),
    direction: directionOf(row.recipe),
    final: outputs.find(({ name }) => name === "video")?.asset ?? null,
    generation: generationSchema.parse(row),
    motionTitle: sampleMotionTitle(source.id),
    outputs,
    poster: outputs.find(({ name }) => name === "poster")?.asset ?? null,
    prerendered: row.is_prerendered,
    recipe: row.recipe,
    rerunOfParent: parent?.recipe.params.seed === row.recipe.params.seed,
    source,
  };
}
