import { z } from "zod";

import { generationSchema } from "../../contracts.ts";
import { mediaUrl } from "../../media.ts";
import { findGeneration, findShared, readOutputs } from "./generations.ts";
import { settleAbandoned } from "./service.ts";

/**
 * What `/g/:id` shows of a generation whatever its workflow, for a page that renders it by the
 * media of its outputs: the generation as stored (a `preparing` row a stopped server left is
 * settled first), its named outputs once done, whether it is a pre-rendered sample (whose page is
 * public), its recipe and its workflow; `null` for a malformed or unknown id. It never asks
 * Comfy: the page's event stream finalizes a row Comfy has finished.
 */
export function readGenerationResult(id: string) {
  const parsed = z.uuid().safeParse(id);
  const stored = parsed.success ? findGeneration(parsed.data) : null;

  if (!stored) {
    return null;
  }

  const row = settleAbandoned(stored);

  return {
    generation: generationSchema.parse(row),
    outputs: row.status === "done" ? readOutputs(row.id) : [],
    prerendered: row.is_prerendered,
    recipe: row.recipe,
    workflow: { id: row.workflow_id, version: row.workflow_version },
  };
}

/**
 * What `/r/:slug` shows of a done generation whatever its workflow, or `null` for a slug no done
 * generation with outputs has: its named outputs, each with its absolute URL from `origin` (for
 * the Open Graph tags), the page's own URL, when it finished, its recipe and its workflow.
 */
export function readGenerationShare(slug: string, origin: string) {
  const row = /^[0-9a-f]{16}$/.test(slug) ? findShared(slug) : null;
  const outputs = row ? readOutputs(row.id) : [];

  if (!row || outputs.length === 0) {
    return null;
  }

  return {
    finishedAt: row.finished_at,
    outputs: outputs.map((output) => ({ ...output, url: `${origin}${mediaUrl(output.asset)}` })),
    pageUrl: `${origin}/r/${slug}`,
    recipe: row.recipe,
    workflow: { id: row.workflow_id, version: row.workflow_version },
  };
}
