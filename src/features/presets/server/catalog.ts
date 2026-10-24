import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { findBySha256 } from "../../../shared/server/assets.ts";
import { workflows } from "../../../shared/server/generation/definition.ts";
import { assetsDirectory } from "../../../shared/server/paths.ts";
import { findPreset, type Preset, presets } from "../catalog.ts";
import type { PresetAvailability, PresetView } from "../contracts.ts";

/** The Motion Transfer definition a preset was made for, if this server runs it. */
export function presetWorkflow({ workflow }: Preset) {
  return workflows.find({ workflow_id: workflow.id, workflow_version: workflow.version });
}

/**
 * Whether `preset` can render here (`PresetAvailability`): the server runs its workflow version
 * (`workflows`, the composition's definitions), and its motion clip is stored, by SHA-256, as a
 * video whose file is on disk (seeded from Motion Transfer's sample motions). Read on every call:
 * a preset whose clip goes missing becomes unavailable without a restart.
 */
export function presetAvailability(preset: Preset): PresetAvailability {
  if (!presetWorkflow(preset)) {
    return {
      message: `This server does not run ${preset.workflow.id} v${preset.workflow.version}, the workflow this preset was made for.`,
      reason: "unsupported_workflow",
      status: "unavailable",
    };
  }

  const clip = findBySha256(preset.motion.sha256);

  if (clip?.kind !== "video" || !existsSync(resolve(assetsDirectory(), clip.path))) {
    return {
      message: `The ${preset.motion.title} clip this preset uses is not on this server.`,
      reason: "motion_unavailable",
      status: "unavailable",
    };
  }

  return { motion: clip.id, status: "ready" };
}

/** Every preset of `catalog` with its availability, in catalog order: the gallery `/presets`. */
export function readPresets(catalog: readonly Preset[] = presets): PresetView[] {
  return catalog.map((preset) => ({ availability: presetAvailability(preset), preset }));
}

/** One preset with its availability, or `null` for an id the catalog does not have. */
export function readPreset(id: string, catalog: readonly Preset[] = presets): PresetView | null {
  const preset = findPreset(id, catalog);

  return preset ? { availability: presetAvailability(preset), preset } : null;
}
