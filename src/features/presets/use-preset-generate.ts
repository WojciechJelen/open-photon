import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import type { Direction } from "#/features/motionTransfer/api";
import type { Preset } from "#/features/presets/catalog";
import { type PresetGenerateInput, presetGenerateInputSchema } from "#/features/presets/contracts";
import { presetRequest } from "#/features/presets/draft";
import { generationReceiptSchema } from "#/shared/contracts";
import { callApi, type Refusal } from "#/shared/requests";
import type { HoldForCode } from "#/shared/use-access-code";
import { useRequestSignal } from "#/shared/use-request-signal";

const presetFieldSchema = z.enum(["character_id", "prompt", "seed"]);

/** A choice Generate found wrong. */
type PresetField = z.infer<typeof presetFieldSchema>;

export const presetFieldMessages: Record<PresetField, string> = {
  character_id: "Pick a character first.",
  prompt: "Keep the look under 500 characters.",
  seed: `The seed is a whole number from 0 to ${Number.MAX_SAFE_INTEGER}.`,
};

/** Where Generate stands: nothing yet, sending, the form refused in the browser, or the server's refusal. */
type GenerateState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { errors: PresetField[]; kind: "invalid" }
  | { kind: "refused"; refusal: Refusal };

/**
 * Generate from a preset's page. The choices are checked against `presetGenerateInputSchema` in
 * the browser first: an invalid form says which fields are wrong (`errors`) without calling the
 * server. Otherwise `POST /api/presets/:presetId/generations` starts (or reuses) the take, which
 * opens at `/g/:id`, Motion Transfer's result page. The server's refusal is `failure` (a stale or
 * unavailable preset says so in its `reason`); one that needs the access code is held for it
 * (`hold`) and sent again with the same `request_key` once the code works, so it starts once.
 */
export function usePresetGenerate(preset: Preset, hold: HoldForCode) {
  const navigate = useNavigate();
  const [state, setState] = useState<GenerateState>({ kind: "idle" });
  const nextSignal = useRequestSignal();
  const url = `/api/presets/${encodeURIComponent(preset.id)}/generations`;

  const post = async (input: PresetGenerateInput, requestKey: string) => {
    setState({ kind: "pending" });
    // The request itself is not aborted (one that reached the server finishes there); leaving
    // the page only drops what this page does with the answer.
    const signal = nextSignal();
    const body = JSON.stringify({ ...input, request_key: requestKey });

    const result = await callApi(generationReceiptSchema, url, {
      body,
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (signal.aborted) {
      return;
    }

    if ("data" in result) {
      await navigate({ params: { generationId: result.data.id }, to: "/g/$generationId" });

      return;
    }

    const { refusal } = result;

    setState(
      refusal.reason === "access_required" ? { kind: "idle" } : { kind: "refused", refusal },
    );

    if (refusal.reason === "access_required") {
      hold("preset-generate", "generate", () => void post(input, requestKey));
    }
  };

  const submit = (character: string | undefined, direction: Direction) => {
    const checked = presetGenerateInputSchema.safeParse(
      presetRequest(preset, character, direction),
    );

    if (checked.success) {
      void post(checked.data, crypto.randomUUID());

      return;
    }

    const fields = checked.error.issues.flatMap(({ path }) => {
      const field = presetFieldSchema.safeParse(path[0]);

      return field.success ? [field.data] : [];
    });

    setState({ errors: [...new Set(fields)], kind: "invalid" });
  };

  return {
    errors: state.kind === "invalid" ? state.errors : [],
    failure: state.kind === "refused" ? state.refusal : null,
    pending: state.kind === "pending",
    submit,
  };
}
