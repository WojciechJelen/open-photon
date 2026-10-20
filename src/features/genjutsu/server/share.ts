import { getRequest } from "@tanstack/react-start/server";

import { assetSchema } from "../../../shared/contracts.ts";
import { mediaUrl } from "../../../shared/media.ts";
import { findAsset, findBySha256 } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";
import { motionTransferWorkflow, workflowModelFiles } from "../workflows/registry.ts";
import { findShared } from "./generations.ts";

/**
 * Whether a done generation with a share page shows this asset there: its result, its poster or
 * the motion clip it was made from. Such files are public, like the page (`isPublicAsset`). Each
 * lookup has its index (`007-final-review.sql`).
 */
export function isSharedAsset(assetId: string) {
  const asset = findAsset(assetId);

  if (!asset) {
    return false;
  }

  const shared = "status = 'done' AND share_slug IS NOT NULL";

  return (
    database
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM generations WHERE final_asset_id = :id AND ${shared})
          OR EXISTS (SELECT 1 FROM generations WHERE poster_asset_id = :id AND ${shared})
          OR EXISTS (SELECT 1 FROM generations
            WHERE recipe ->> '$.inputs.driving_video_sha256' = :sha256 AND ${shared}) AS shared`,
      )
      .get({ id: asset.id, sha256: asset.sha256 })?.shared === 1
  );
}

/**
 * The origin absolute links (Open Graph tags, the share link) start with: `PUBLIC_APP_URL` when
 * set, which a deployment behind a proxy needs, else the origin of the request being served.
 */
export function publicOrigin() {
  return new URL(process.env.PUBLIC_APP_URL ?? getRequest().url).origin;
}

/**
 * What `/r/:slug` shows, or `null` for a slug no done generation has: the result and its poster
 * and the source clip (with absolute URLs from `origin` for the Open Graph tags), the recipe, and
 * the model files the recipe's workflow loads, with their licenses once `models.lock` pins them
 * (`null` when the stored workflow file is no longer the recipe's).
 */
export function readShare(slug: string, origin: string) {
  const row = /^[0-9a-f]{16}$/.test(slug) ? findShared(slug) : null;
  const final = row?.final_asset_id ? findAsset(row.final_asset_id) : null;

  if (!row || !final) {
    return null;
  }

  const poster = row.poster_asset_id ? findAsset(row.poster_asset_id) : null;
  const source = findBySha256(row.recipe.inputs.driving_video_sha256);

  if (!source) {
    throw new Error(`Generation ${row.id} has no stored motion clip`);
  }

  const models =
    row.recipe.models.length > 0
      ? row.recipe.models.map(({ file, license }) => ({ file, license }))
      : row.recipe.workflow.sha256 === motionTransferWorkflow.sha256
        ? workflowModelFiles(motionTransferWorkflow.graph).map((file) => ({ file, license: null }))
        : null;

  return {
    final: assetSchema.parse(final),
    finishedAt: row.finished_at,
    models,
    pageUrl: `${origin}/r/${slug}`,
    poster: poster ? assetSchema.parse(poster) : null,
    posterUrl: poster ? `${origin}${mediaUrl(poster)}` : null,
    recipe: row.recipe,
    source: assetSchema.parse(source),
    videoUrl: `${origin}${mediaUrl(final)}`,
  };
}
