import type { PublicAccessDeclaration } from "../../../shared/server/access-policy.ts";
import { findAsset, type StoredAsset } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";

/**
 * Whether a done generation with a share page shows this asset there: its result, its poster or
 * the motion clip it was made from. Such files are public, like the page (`isPublicAsset`). Each
 * lookup has its index (`007-final-review.sql`; it still names `share.ts`, where this lived).
 */
function isSharedAsset(asset: StoredAsset) {
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
 * Whether anyone may load this asset without an access code: a sample (a sample motion's clip or
 * a sample character's image, what the picker shows) or a file a share page shows. Uploads, cuts,
 * character photos and unshared results need a session.
 */
function isPublicMotionTransferAsset(asset: StoredAsset) {
  return asset.role === "sample" || isSharedAsset(asset);
}

/** `isPublicMotionTransferAsset` by asset id: `false` for an id no asset has. */
export function isPublicAsset(assetId: string) {
  const asset = findAsset(assetId);

  return asset !== null && isPublicMotionTransferAsset(asset);
}

/** Whether a generation is a pre-rendered sample, whose page and API anyone may read. */
function isPrerendered(match: RegExpExecArray) {
  return (
    database
      .prepare("SELECT 1 FROM generations WHERE id = ? AND is_prerendered = 1")
      .get(match[1] ?? "") !== undefined
  );
}

// A share page, as the router matches it.
const sharePage = /^\/r\/[^/]+$/i;

/**
 * What Motion Transfer opens without the access code (`createAccessPolicy`, composed in
 * `src/app/server.ts`):
 * - the server functions of the wizard's data, the studio home's, the share page's, and
 *   `/g/:id`'s, which checks access itself (a pre-rendered sample's page is public, any other
 *   needs a session);
 * - the wizard `/motionTransfer` that picks the motion and character, share pages, and the page
 *   and API of a pre-rendered sample generation;
 * - the two actions that may answer with a result that already exists, for free:
 *   `POST /api/generate` (a pre-rendered sample × sample result) and
 *   `POST /api/generations/:id/rerun` (a done generation's own result); they refuse anything that
 *   would submit a job (`generate.ts`);
 * - samples and the files a share page shows (`isPublicMotionTransferAsset`);
 * - for search engines, share pages and the files they show (`isSharedAsset`).
 */
export const motionTransferAccess: PublicAccessDeclaration = {
  indexableRoutes: [sharePage],
  isIndexableAsset: isSharedAsset,
  isPublicAsset: isPublicMotionTransferAsset,
  publicRoutes: [
    { method: "POST", pattern: /^\/api\/(?:generate|generations\/[^/]+\/rerun)$/i },
    { method: "GET", pattern: /^\/motionTransfer$/i },
    { method: "GET", pattern: sharePage },
    { method: "GET", pattern: /^\/(?:g|api\/generations)\/([0-9a-f-]{36})$/i, when: isPrerendered },
    {
      method: "GET",
      pattern: /^\/api\/generations\/([0-9a-f-]{36})\/(?:events|recipe\.json)$/i,
      when: isPrerendered,
    },
  ],
  publicServerFns: {
    "src/features/motionTransfer/generate.functions.ts#loadResult": true,
    "src/features/motionTransfer/generate.functions.ts#loadShare": true,
    "src/features/motionTransfer/selection.functions.ts#loadSelection": true,
    "src/features/motionTransfer/selection.functions.ts#loadStudio": true,
  },
};
