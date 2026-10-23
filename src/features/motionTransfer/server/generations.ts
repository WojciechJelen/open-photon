import {
  type DecodedGeneration,
  findGeneration as findStoredGeneration,
  findShared as findStoredShared,
  type Generation,
} from "../../../shared/server/generation/generations.ts";
import { motionTransferDefinition } from "../workflows/definition.ts";
import { type Recipe, recipeSchema } from "./recipe.ts";

/** A Motion Transfer generation, with its recipe decoded. */
export type MotionTransferGeneration = DecodedGeneration<Recipe>;

/** `row` with its recipe decoded when it is a Motion Transfer generation; `null` otherwise. */
export function asMotionTransfer(row: Generation | null): MotionTransferGeneration | null {
  return row?.workflow_id === motionTransferDefinition.id &&
    row.workflow_version === motionTransferDefinition.version
    ? { ...row, recipe: recipeSchema.parse(row.recipe) }
    : null;
}

/** The Motion Transfer generation with this id; `null` for none, or another workflow's. */
export function findGeneration(id: string) {
  return asMotionTransfer(findStoredGeneration(id));
}

/** The done Motion Transfer generation whose share page is `/r/<slug>`. */
export function findShared(slug: string) {
  return asMotionTransfer(findStoredShared(slug));
}
