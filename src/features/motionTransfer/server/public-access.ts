import type { PublicAccessDeclaration } from "../../../shared/server/access-policy.ts";
import { findAsset, type StoredAsset } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";
import { isSharedOutput } from "../../../shared/server/generation/generations.ts";

/**
 * Whether a done Motion Transfer generation with a share page was made from this motion clip
 * (`recipe.inputs.driving_video_sha256`): its share page shows it beside the result, so it is
 * public like the page. Indexed (`generations_shared_source`, `007-final-review.sql`).
 */
function isSharedSourceClip(asset: StoredAsset) {
  return (
    database
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM generations
          WHERE recipe ->> '$.inputs.driving_video_sha256' = ?
            AND status = 'done' AND share_slug IS NOT NULL) AS shared`,
      )
      .get(asset.sha256)?.shared === 1
  );
}

/** Whether this asset is a sample motion's clip, which the picker shows to anyone. */
function isSampleMotionClip(asset: StoredAsset) {
  return (
    database
      .prepare("SELECT EXISTS (SELECT 1 FROM motions WHERE source_asset_id = ?) AS sample")
      .get(asset.id)?.sample === 1
  );
}

/**
 * Whether anyone may load this asset without an access code, as far as Motion Transfer decides:
 * a sample motion's clip or the source clip of a share page. Uploads, cuts and unshared results
 * need a session; the sample characters' images are the characters feature's to open.
 */
function isPublicMotionTransferAsset(asset: StoredAsset) {
  return isSampleMotionClip(asset) || isSharedSourceClip(asset);
}

/**
 * Whether a page of Motion Transfer may show this motion clip to a visitor without a session: one
 * it makes public (`isPublicMotionTransferAsset`) or an output of a shared generation
 * (`isSharedOutput`); `false` for an id no asset has. A character's visibility is the characters
 * feature's (`visibleCharacter`).
 */
export function isPublicAsset(assetId: string) {
  const asset = findAsset(assetId);

  return asset !== null && (isPublicMotionTransferAsset(asset) || isSharedOutput(asset));
}

/**
 * What Motion Transfer opens without the access code (`createAccessPolicy`, composed in
 * `src/app/server.ts`, beside what every generation opens, `generationAccess`):
 * - the server functions of the wizard's data, the studio home's, the share page's, and
 *   `/g/:id`'s, which checks access itself (a pre-rendered sample's page is public, any other
 *   needs a session);
 * - the wizard `/motionTransfer` that picks the motion and character;
 * - `POST /api/generate`, which may answer with a result that already exists (a pre-rendered
 *   sample × sample result) for free and refuses anything that would submit a job (`generate`);
 * - the sample motions' clips and the source clips share pages show
 *   (`isPublicMotionTransferAsset`); for search engines, those source clips. The sample
 *   characters' images are opened by `charactersAccess`.
 */
export const motionTransferAccess: PublicAccessDeclaration = {
  isIndexableAsset: isSharedSourceClip,
  isPublicAsset: isPublicMotionTransferAsset,
  publicRoutes: [
    { method: "POST", pattern: /^\/api\/generate$/i },
    { method: "GET", pattern: /^\/motionTransfer$/i },
  ],
  publicServerFns: {
    "src/features/motionTransfer/generate.functions.ts#loadResult": true,
    "src/features/motionTransfer/generate.functions.ts#loadShare": true,
    "src/features/motionTransfer/selection.functions.ts#loadSelection": true,
    "src/features/motionTransfer/selection.functions.ts#loadStudio": true,
  },
};
