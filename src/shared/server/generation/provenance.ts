import type { z } from "zod";

import type { generationStatusSchema } from "../../contracts.ts";
import { recipeIdentitySchema, workflows } from "./definition.ts";
import { findGeneration } from "./generations.ts";

type RecipeIdentity = z.infer<typeof recipeIdentitySchema>;

/** What `readGenerationProvenance` reads of a stored generation. */
type GenerationProvenance = {
  models: RecipeIdentity["models"];
  prompt: string | null;
  status: z.infer<typeof generationStatusSchema>;
  workflow: RecipeIdentity["workflow"];
};

/**
 * What a stored generation was made with, for what a feature saves from its output (a generated
 * character): its `status`, the workflow file (`workflow`: id, version, SHA-256) and model pins
 * (`models`) its recipe records, and the text prompt it rendered (`prompt`, from its
 * definition's `promptOf`; `null` when the workflow declares none or no feature registers it any
 * more). Read from the stored recipe only, never from a client. `null` for an id no generation
 * has. The recipe's shape stays its definition's: callers get these fields, never the recipe.
 */
export function readGenerationProvenance(id: string): GenerationProvenance | null {
  const row = findGeneration(id);

  if (!row) {
    return null;
  }

  // Decoded by its definition when a feature still registers it; every recipe carries its identity.
  const definition = workflows.find(row);
  const recipe = definition?.recipeSchema.parse(row.recipe);
  const { models, workflow } = recipeIdentitySchema.parse(recipe ?? row.recipe);
  const prompt = recipe === undefined ? undefined : definition?.promptOf?.(recipe);

  return { models, prompt: prompt ?? null, status: row.status, workflow };
}
