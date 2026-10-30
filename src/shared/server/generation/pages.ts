import { z } from "zod";

import { mediaUrl } from "../../media.ts";
import { workflows } from "./definition.ts";
import { findGeneration, findShared, readOutputs, snapshot } from "./generations.ts";
import { settleAbandoned } from "./service.ts";

/**
 * What `/g/:id` shows of a generation whatever its workflow, for a page that renders it by the
 * media of its outputs: the generation as stored (a `preparing` row a stopped server left is
 * settled first; a `waiting` one with its place in line), its named outputs once done, whether it
 * is a pre-rendered sample (whose page is public), its recipe, its workflow, what that workflow
 * makes (`media`, for a page with no outputs to go by yet) and when it publishes (`publish`:
 * `"on-request"` when its owner may publish it from the page); `null` for a malformed or unknown
 * id. It never asks Comfy: the page's event stream finalizes a
 * row Comfy has finished.
 */
export function readGenerationResult(id: string) {
  const parsed = z.uuid().safeParse(id);
  const stored = parsed.success ? findGeneration(parsed.data) : null;

  if (!stored) {
    return null;
  }

  const row = settleAbandoned(stored);
  const definition = workflows.find(row);
  const declared = definition?.outputs.map(({ media }) => media) ?? [];

  const media: "image" | "video" | null = declared.includes("video")
    ? "video"
    : declared.includes("image")
      ? "image"
      : null;

  return {
    generation: snapshot(row),
    media,
    outputs: row.status === "done" ? readOutputs(row.id) : [],
    prerendered: row.is_prerendered,
    publish: definition?.publish ?? "on-done",
    recipe: row.recipe,
    workflow: { id: row.workflow_id, version: row.workflow_version },
  };
}

/**
 * What `/r/:slug` shows of a done generation whatever its workflow, or `null` for a slug no done
 * generation with outputs has: its named outputs, each with its absolute URL from `origin` (for
 * the Open Graph tags), the page's own URL, when it finished, its recipe as its workflow lets a
 * public page show it (`shareRecipe`; the stored recipe for a workflow without one) and its
 * workflow.
 */
export function readGenerationShare(slug: string, origin: string) {
  const row = /^[0-9a-f]{16}$/.test(slug) ? findShared(slug) : null;
  const outputs = row ? readOutputs(row.id) : [];

  if (!row || outputs.length === 0) {
    return null;
  }

  const definition = workflows.find(row);

  const recipe = definition?.shareRecipe
    ? definition.shareRecipe(definition.recipeSchema.parse(row.recipe))
    : row.recipe;

  return {
    finishedAt: row.finished_at,
    outputs: outputs.map((output) => ({ ...output, url: `${origin}${mediaUrl(output.asset)}` })),
    pageUrl: `${origin}/r/${slug}`,
    recipe,
    workflow: { id: row.workflow_id, version: row.workflow_version },
  };
}
