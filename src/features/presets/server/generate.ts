import type { Session } from "../../../shared/server/access.server.ts";
import { comfyProvider, type Provider } from "../../../shared/server/comfy-provider.ts";
import { database } from "../../../shared/server/db.server.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { answer, readInput } from "../../../shared/server/generation/http.ts";
import { type Admit, submit } from "../../../shared/server/generation/service.ts";
import { findPreset, type Preset, presets } from "../catalog.ts";
import { type PresetGenerateInput, presetGenerateInputSchema } from "../contracts.ts";
import { resolveDirection } from "../draft.ts";
import { presetAvailability, presetWorkflow } from "./catalog.ts";

type PresetGenerateOptions = {
  admit?: Admit;
  /** The catalog to resolve against; the shipped one (tests pass an edited one). */
  catalog?: readonly Preset[];
  provider?: Provider;
  requestKey?: string;
};

/** Records which preset version a new generation was submitted from (`preset_generations`). */
function recordProvenance(generationId: string, preset: Preset, input: PresetGenerateInput) {
  const overrides = { prompt: input.prompt, seed: input.seed };

  database
    .prepare(
      `INSERT INTO preset_generations (generation_id, preset_id, preset_version, preset, overrides,
  created_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (generation_id) DO NOTHING`,
    )
    .run(
      generationId,
      preset.id,
      preset.version,
      JSON.stringify(preset),
      JSON.stringify(overrides),
      new Date().toISOString(),
    );
}

/**
 * A Motion Transfer take from preset `presetId` (`POST /api/presets/:presetId/generations`).
 * Everything that could make it fail is checked before the generation service is called, so a
 * refused request stores nothing and spends no quota:
 *
 * - 404 `preset_not_found`: the catalog has no such preset (any more);
 * - 409 `preset_stale`: the visitor saw another version than the catalog has now;
 * - 409 `preset_unavailable`: this server cannot render it (`presetAvailability`);
 * - 422 `invalid_input`: the resolved choices are not a Motion Transfer input.
 *
 * Then the preset's look and seed, with the visitor's changes (`resolveDirection`), and its stored
 * motion clip become Motion Transfer's input, submitted through the generation service like
 * `POST /api/generate` (the same recipe, so the same take made in the wizard is reused, and a
 * pre-rendered sample take comes back without a session). A new generation records the preset
 * version it came from (`preset_generations`); its recipe holds the concrete values, so a re-run
 * renders them whatever the catalog says later.
 */
export async function generateFromPreset(
  presetId: string,
  input: PresetGenerateInput,
  session: Session | null,
  { admit, catalog = presets, provider = comfyProvider, requestKey }: PresetGenerateOptions = {},
) {
  const preset = findPreset(presetId, catalog);

  if (!preset) {
    throw new GenerateError(404, "This preset is not in the catalog.", "preset_not_found");
  }

  if (input.version !== preset.version) {
    throw new GenerateError(
      409,
      `This preset changed since it was opened (version ${input.version}, now ${preset.version}). Review the current version, then generate.`,
      "preset_stale",
    );
  }

  const availability = presetAvailability(preset);
  const definition = presetWorkflow(preset);

  if (availability.status !== "ready" || !definition) {
    throw new GenerateError(
      409,
      availability.status === "ready" ? "This preset cannot render here." : availability.message,
      "preset_unavailable",
    );
  }

  const direction = resolveDirection(preset, input);

  const parsed = definition.inputSchema.safeParse({
    character_id: input.character_id,
    motion_asset_id: availability.motion,
    prompt: direction.prompt,
    seed: direction.seed,
  });

  if (!parsed.success) {
    throw new GenerateError(
      422,
      "These choices are not a take Motion Transfer can render.",
      "invalid_input",
    );
  }

  const receipt = await submit(definition, parsed.data, {
    admit,
    provider,
    requestKey,
    scope: { free: (existing) => existing.status === "done" && existing.is_prerendered, session },
  });

  if (!receipt.reused) {
    recordProvenance(receipt.id, preset, input);
  }

  return receipt;
}

/**
 * `POST /api/presets/:presetId/generations` with a JSON `presetGenerateInputSchema` body and an
 * optional `request_key`: `generateFromPreset`, answered by `answer` like `POST /api/generate`
 * (201, 202 waiting, 200 reused, or the refusal's status and reason).
 */
export function handlePresetGenerate(
  request: Request,
  presetId: string,
  provider: Provider = comfyProvider,
) {
  return answer(request, async (session, admit) => {
    const { input, requestKey } = await readInput(request, presetGenerateInputSchema, 16_384);

    return generateFromPreset(presetId, input, session, { admit, provider, requestKey });
  });
}
