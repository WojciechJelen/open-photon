import type { PublicAccessDeclaration } from "../../../shared/server/access-policy.ts";
import type { StoredAsset } from "../../../shared/server/assets.ts";
import { database } from "../../../shared/server/db.server.ts";

/**
 * Whether this asset is a sample character's image (`characters_sample_image`), which the picker
 * shows to anyone.
 */
function isSampleCharacterImage(asset: StoredAsset) {
  return (
    database
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM characters
          WHERE image_asset_id = ? AND is_sample = 1) AS sample`,
      )
      .get(asset.id)?.sample === 1
  );
}

/**
 * What the characters feature opens without the access code (`createAccessPolicy`, composed in
 * `src/app/server.ts`): the sample characters' images. An uploaded likeness never is; a generated
 * character's image is a generation's output, public only as that generation's share page makes
 * it (`generationAccess`). Its upload endpoint (`POST /api/characters`) needs a session.
 */
export const charactersAccess: PublicAccessDeclaration = { isPublicAsset: isSampleCharacterImage };
