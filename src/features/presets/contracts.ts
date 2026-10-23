// The presets feature's HTTP and server-function contracts. Client-safe and loadable by Node.
import { z } from "zod";

import type { Preset } from "./catalog.ts";

/**
 * Whether a preset can render on this server, as `presetAvailability` finds it: `ready` with the
 * stored clip of its motion (`motion`, the asset id a Motion Transfer draft names), or
 * `unavailable` with why (`unsupported_workflow`: the server does not run the workflow version
 * the preset was made for; `motion_unavailable`: its clip is not stored) in words.
 */
export type PresetAvailability =
  | { motion: string; status: "ready" }
  | {
      message: string;
      reason: "motion_unavailable" | "unsupported_workflow";
      status: "unavailable";
    };

/** A preset as the gallery and its page get it: the catalog entry and its availability. */
export type PresetView = { availability: PresetAvailability; preset: Preset };

/**
 * The JSON body of `POST /api/presets/:presetId/generations`, plus an optional `request_key` (a
 * UUID). `version` is the preset version the visitor saw; `prompt` and `seed` are only what they
 * changed, as a Motion Transfer draft says it: left out, the preset's own; `prompt: ""` the
 * photo's look (Motion Transfer's default description), `seed: "default"` Motion Transfer's fixed
 * seed. The server resolves them into concrete values before the take is submitted.
 */
export const presetGenerateInputSchema = z.object({
  character_id: z.uuid(),
  prompt: z.string().trim().max(500).optional(),
  seed: z.union([z.int().min(0).max(Number.MAX_SAFE_INTEGER), z.literal("default")]).optional(),
  version: z.int().positive(),
});

export type PresetGenerateInput = z.output<typeof presetGenerateInputSchema>;
