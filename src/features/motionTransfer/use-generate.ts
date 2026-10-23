import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { type GenerateInput, generateInputSchema } from "#/features/motionTransfer/contracts";
import { generationReceiptSchema } from "#/shared/contracts";
import { callApi, type Refusal } from "#/shared/requests";
import type { HoldForCode } from "#/shared/use-access-code";
import { useRequestSignal } from "#/shared/use-request-signal";

export type Field = "angle" | "character_id" | "motion_asset_id" | "prompt" | "seed";

export const fieldMessages: Record<Field, string> = {
  angle: "Choose one of the angles.",
  character_id: "Pick a character first.",
  motion_asset_id: "Pick a motion first.",
  prompt: "Keep the look under 500 characters.",
  seed: `The seed is a whole number from 0 to ${Number.MAX_SAFE_INTEGER}.`,
};

const fields = new Set<string>(Object.keys(fieldMessages));

function isField(key: PropertyKey | undefined): key is Field {
  return fields.has(String(key));
}

/** The key a Generate waiting for the access code is held under (`useAccessCode`). */
export const generateHold = "generate";

/** The Direct step's choices, as the form holds them: `none` is "As filmed", blank is default. */
export type Direction = { angle: string; prompt: string; seed: string };

/**
 * Generate, for the wizard: the choices are checked against `generateInputSchema` in the browser
 * first, and an invalid form says why (`errors`) and never calls the server. A started (or
 * reused) generation opens at `/g/:id`. A refusal is `failure` (a full queue or too many
 * generations say when to try again); one that needs an access code is held for it (`hold`, under
 * `generateHold`), and the same input is sent again once the code works (a pre-rendered sample pair needs none: the
 * server answers it first). A blank look is the workflow default, a blank seed the fixed one.
 */
export function useGenerate(hold: HoldForCode) {
  const navigate = useNavigate();
  const [errors, setErrors] = useState<Field[]>([]);
  const [failure, setFailure] = useState<Refusal | null>(null);
  const [pending, setPending] = useState(false);
  const nextSignal = useRequestSignal();

  async function send(input: GenerateInput) {
    setPending(true);
    setFailure(null);

    // Not passed to the request: a submit that reached the server finishes there. Leaving the
    // page only drops the navigation to its result.
    const signal = nextSignal();

    const answer = await callApi(generationReceiptSchema, "/api/generate", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (signal.aborted) {
      return;
    }

    if ("refusal" in answer) {
      setPending(false);

      if (answer.refusal.reason === "access_required") {
        hold(generateHold, "generate", () => void send(input));
      } else {
        setFailure(answer.refusal);
      }
    } else {
      await navigate({ params: { generationId: answer.data.id }, to: "/g/$generationId" });
    }
  }

  function submit(
    picks: { character: string | undefined; motion: string | undefined },
    { angle, prompt, seed }: Direction,
  ) {
    const parsed = generateInputSchema.safeParse({
      angle: angle === "none" ? undefined : angle,
      character_id: picks.character,
      motion_asset_id: picks.motion,
      prompt: prompt.trim() || undefined,
      // Anything but digits becomes NaN, which the schema refuses.
      seed: seed.trim() === "" ? undefined : /^\d+$/.test(seed.trim()) ? Number(seed) : Number.NaN,
    });

    setFailure(null);

    if (!parsed.success) {
      setErrors([
        ...new Set(
          parsed.error.issues.flatMap(({ path: [field] }) => (isField(field) ? [field] : [])),
        ),
      ]);

      return;
    }

    setErrors([]);
    void send(parsed.data);
  }

  return { errors, failure, pending, submit };
}
