-- Named outputs: each file a generation produced, under the name its workflow declares
-- (`OutputDeclaration`, src/shared/server/generation/definition.ts), one asset per name. Readers go
-- through this table; `final_asset_id` and `poster_asset_id` keep mirroring the outputs `video`
-- and `poster` for the readers of those columns (`transition`).
CREATE TABLE generation_outputs (
  generation_id TEXT NOT NULL REFERENCES generations (id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  asset_id TEXT NOT NULL REFERENCES assets (id),
  PRIMARY KEY (generation_id, name)
);

-- `isSharedOutput` runs for every public media request.
CREATE INDEX generation_outputs_asset ON generation_outputs (asset_id);

-- Every generation made before outputs had names was a Motion Transfer render: its MP4 is the
-- output `video`, the JPEG cut from it the output `poster`.
INSERT INTO generation_outputs (generation_id, name, asset_id)
SELECT id, 'video', final_asset_id FROM generations WHERE final_asset_id IS NOT NULL;

INSERT INTO generation_outputs (generation_id, name, asset_id)
SELECT id, 'poster', poster_asset_id FROM generations WHERE poster_asset_id IS NOT NULL;

-- Sharing reads the outputs now (`generation_outputs_asset`); the source clip keeps its index,
-- `generations_shared_source`.
DROP INDEX generations_shared_final;
DROP INDEX generations_shared_poster;

-- The non-secret identity of the endpoint a job was submitted to (`ProviderTarget`): the origin
-- of a self-hosted proxy's `COMFY_BASE_URL`, null on Cloud. Credentials are never stored. Rows made
-- before it keep null, as nothing records which origin they used.
ALTER TABLE generations ADD COLUMN target_origin TEXT;

-- When the graph was handed to the provider (`markSubmitting`): a row a stopped server left
-- `preparing` with it may have a job there, so it becomes `unknown`, never `failed`, even when its
-- workflow uploads no file (and so records no `provider_inputs`).
ALTER TABLE generations ADD COLUMN submit_started_at TEXT;
