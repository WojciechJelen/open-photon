import { z } from "zod";

/** The wizard's steps at `/motionTransfer`; the fourth, Render, is the generation's page `/g/:id`. */
const wizardSteps = ["motion", "character", "direct"] as const;

export type WizardStep = (typeof wizardSteps)[number];

/**
 * The wizard's state in the URL: the step and both picks, so a reload, Back and Forward and a
 * shared link all land on the same screen, and `from`, the generation whose direction (angle,
 * look, seed) the Direct step starts with ("Change the shot", the remixes). An id that is not a
 * UUID is dropped, and so is an unknown step, so a mangled link falls back to no choice.
 */
export const wizardSearchSchema = z.object({
  step: z.enum(wizardSteps).optional().catch(undefined),
  motion: z.uuid().optional().catch(undefined),
  character: z.uuid().optional().catch(undefined),
  from: z.uuid().optional().catch(undefined),
});

export type WizardSearch = z.output<typeof wizardSearchSchema>;

/**
 * The step to show for `step` and the picks the URL holds: a step is reachable once every step
 * before it has its pick (Character needs a motion, Direct needs both), so a link to a step
 * whose prerequisites are missing shows the furthest one it can reach. Without a step, the first
 * one still to pick, or Direct when both are picked: a remix link names only what it keeps.
 */
export function shownStep(
  step: WizardStep | undefined,
  { character, motion }: { character: string | null; motion: string | null },
): WizardStep {
  const reachable: WizardStep = !motion ? "motion" : !character ? "character" : "direct";

  if (!step) {
    return reachable;
  }

  return wizardSteps.indexOf(step) <= wizardSteps.indexOf(reachable) ? step : reachable;
}
