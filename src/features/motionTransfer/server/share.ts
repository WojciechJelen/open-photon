import { getRequest } from "@tanstack/react-start/server";

import { mediaUrl } from "../../../shared/media.ts";
import { readOutputs } from "../../../shared/server/generation/generations.ts";
import { workflowModelFiles } from "../../../shared/server/models-lock.ts";
import { getCharacter, visibleCharacter } from "../../characters/api.ts";
import { motionTransferWorkflow } from "../workflows/registry.ts";
import { findShared } from "./generations.ts";
import { COMPARE_OUTPUT } from "./media/compare.ts";
import { sampleMotionTitle, sourceClip } from "./shot.ts";

/**
 * The origin absolute links (Open Graph tags, the share link) start with: `PUBLIC_APP_URL` when
 * set, which a deployment behind a proxy needs, else the origin of the request being served.
 */
export function publicOrigin() {
  return new URL(process.env.PUBLIC_APP_URL ?? getRequest().url).origin;
}

/**
 * What `/r/:slug` shows of a Motion Transfer generation, or `null` for a slug no done one has: its
 * named outputs (`outputs`; the result and its poster as `final` and `poster`, with absolute URLs
 * from `origin` for the Open Graph tags, and its side-by-side as `compare`, `null` when its stitch
 * failed) and the source clip with its sample title if it is one,
 * the character as a visitor without a session may see it (`visibleCharacter`: a sample's, never
 * an uploaded photo), the recipe, and the model files the recipe's workflow loads, with their
 * licenses once `models.lock` pins them (`null` when the stored workflow file is no longer the
 * recipe's).
 */
export function readShare(slug: string, origin: string) {
  const row = /^[0-9a-f]{16}$/.test(slug) ? findShared(slug) : null;
  const outputs = row ? readOutputs(row.id) : [];
  const final = outputs.find(({ name }) => name === "video")?.asset;

  if (!row || !final) {
    return null;
  }

  const poster = outputs.find(({ name }) => name === "poster")?.asset ?? null;
  const source = sourceClip(row);
  const character = row.character_id ? getCharacter(row.character_id) : null;

  const models =
    row.recipe.models.length > 0
      ? row.recipe.models.map(({ file, license }) => ({ file, license }))
      : row.recipe.workflow.sha256 === motionTransferWorkflow.sha256
        ? workflowModelFiles(motionTransferWorkflow.graph).map((file) => ({ file, license: null }))
        : null;

  return {
    character: visibleCharacter(character, false),
    compare: outputs.find(({ name }) => name === COMPARE_OUTPUT)?.asset ?? null,
    final,
    finishedAt: row.finished_at,
    models,
    motionTitle: sampleMotionTitle(source.id),
    outputs,
    pageUrl: `${origin}/r/${slug}`,
    poster,
    posterUrl: poster ? `${origin}${mediaUrl(poster)}` : null,
    recipe: row.recipe,
    source,
    videoUrl: `${origin}${mediaUrl(final)}`,
  };
}
