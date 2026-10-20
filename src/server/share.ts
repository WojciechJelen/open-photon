import { getRequest } from "@tanstack/react-start/server";

import { assetSchema } from "../lib/contracts.ts";
import { mediaUrl } from "../lib/media.ts";
import { findAsset, findBySha256 } from "./assets.ts";
import { database } from "./db.server.ts";
import { findShared } from "./generations.ts";
import { loadWorkflow, workflowModelFiles } from "./workflows/registry.ts";

/**
 * Whether a done generation with a share page shows this asset there: its result, its poster or
 * the motion clip it was made from. Such files are public, like the page; no other asset is.
 */
export function isSharedAsset(assetId: string) {
  return (
    database
      .prepare(
        `SELECT 1 FROM generations
        WHERE status = 'done' AND share_slug IS NOT NULL
          AND (final_asset_id = :id OR poster_asset_id = :id
            OR recipe ->> '$.inputs.driving_video_sha256' = (SELECT sha256 FROM assets WHERE id = :id))
        LIMIT 1`,
      )
      .get({ id: assetId }) !== undefined
  );
}

/**
 * What anyone may open without the access code, so a share link unfurls on social sites and
 * opens for whoever gets it: `/r/<slug>` (an unknown slug is the page's own 404) and the media a
 * share page shows (`isSharedAsset`).
 */
export function isPublicPath(pathname: string) {
  if (/^\/r\/[^/]+$/.test(pathname)) {
    return true;
  }

  const assetId = /^\/media\/([0-9a-f-]{36})\.[a-z0-9]+$/.exec(pathname)?.[1];

  return assetId !== undefined && isSharedAsset(assetId);
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
export async function readShare(slug: string, origin: string) {
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

  const workflow = await loadWorkflow("motion-transfer", 1);

  const models =
    row.recipe.models.length > 0
      ? row.recipe.models.map(({ file, license }) => ({ file, license }))
      : row.recipe.workflow.sha256 === workflow.sha256
        ? workflowModelFiles(workflow.graph).map((file) => ({ file, license: null }))
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
