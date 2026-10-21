-- Columns of docs/mvp-implementation-plan.md §7 that nothing ever wrote a meaningful value to:
-- `kind` (always 'render'), `output_asset_id` (always `final_asset_id`, as nothing is muxed) and
-- `client_hash` (the rate limits key clients in memory, src/shared/server/limits.ts).
ALTER TABLE generations DROP COLUMN kind;
ALTER TABLE generations DROP COLUMN output_asset_id;
ALTER TABLE generations DROP COLUMN client_hash;

-- assets.license_ref stays, empty: reserved for Step 9.1 (the license file of each sample).

-- When `finalize` last failed for the row; the next attempt waits a little longer each time, and
-- the third failure fails the row (`finalize_failed`, src/features/motionTransfer/server/finalize.ts).
ALTER TABLE generations ADD COLUMN finalize_attempted_at TEXT;

-- `motion_id` names the sample motion a generation's driving clip is (`createGeneration`), for the
-- rows made before it was written.
UPDATE generations SET motion_id = (
  SELECT motions.id FROM motions JOIN assets ON assets.id = motions.source_asset_id
  WHERE assets.sha256 = generations.recipe ->> '$.inputs.driving_video_sha256'
)
WHERE motion_id IS NULL;

-- `isSharedAsset` (src/features/motionTransfer/server/share.ts) runs for every public media request: one index per way a
-- done, shared generation shows an asset.
CREATE INDEX generations_shared_final ON generations (final_asset_id)
WHERE status = 'done' AND share_slug IS NOT NULL;

CREATE INDEX generations_shared_poster ON generations (poster_asset_id)
WHERE status = 'done' AND share_slug IS NOT NULL;

CREATE INDEX generations_shared_source ON generations (recipe ->> '$.inputs.driving_video_sha256')
WHERE status = 'done' AND share_slug IS NOT NULL;
