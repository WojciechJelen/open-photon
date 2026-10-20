import { getRequest } from "@tanstack/react-start/server";

import { assetSchema } from "../../../shared/contracts.ts";
import { mediaUrl } from "../../../shared/media.ts";
import { findAsset } from "../../../shared/server/assets.ts";
import { motionTransferWorkflow, workflowModelFiles } from "../workflows/registry.ts";
import { findCharacter } from "./characters.server.ts";
import { findShared } from "./generations.ts";
import { sampleMotionTitle, sourceClip, visibleCharacter } from "./shot.ts";

/**
 * The origin absolute links (Open Graph tags, the share link) start with: `PUBLIC_APP_URL` when
 * set, which a deployment behind a proxy needs, else the origin of the request being served.
 */
export function publicOrigin() {
  return new URL(process.env.PUBLIC_APP_URL ?? getRequest().url).origin;
}

/**
 * What `/r/:slug` shows, or `null` for a slug no done generation has: the result and its poster
 * and the source clip (with absolute URLs from `origin` for the Open Graph tags) with its sample
 * title if it is one, the character as a visitor without a session may see it
 * (`visibleCharacter`: a sample's, never an uploaded photo), the recipe, and the model files the
 * recipe's workflow
 * loads, with their licenses once `models.lock` pins them (`null` when the stored workflow file
 * is no longer the recipe's).
 */
export function readShare(slug: string, origin: string) {
  const row = /^[0-9a-f]{16}$/.test(slug) ? findShared(slug) : null;
  const final = row?.final_asset_id ? findAsset(row.final_asset_id) : null;

  if (!row || !final) {
    return null;
  }

  const poster = row.poster_asset_id ? findAsset(row.poster_asset_id) : null;
  const source = sourceClip(row);
  const character = row.character_id ? findCharacter(row.character_id) : null;

  const models =
    row.recipe.models.length > 0
      ? row.recipe.models.map(({ file, license }) => ({ file, license }))
      : row.recipe.workflow.sha256 === motionTransferWorkflow.sha256
        ? workflowModelFiles(motionTransferWorkflow.graph).map((file) => ({ file, license: null }))
        : null;

  return {
    character: visibleCharacter(character, false),
    final: assetSchema.parse(final),
    finishedAt: row.finished_at,
    models,
    motionTitle: sampleMotionTitle(source.id),
    pageUrl: `${origin}/r/${slug}`,
    poster: poster ? assetSchema.parse(poster) : null,
    posterUrl: poster ? `${origin}${mediaUrl(poster)}` : null,
    recipe: row.recipe,
    source,
    videoUrl: `${origin}${mediaUrl(final)}`,
  };
}
