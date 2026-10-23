-- Text outputs (`OutputDeclaration` media `text`, src/shared/server/generation/definition.ts): the
-- text a workflow's display node shows, such as an enhanced caption, stored as a UTF-8 `.txt`
-- asset of kind `text` (role `provider_output`), never public. SQLite cannot change a CHECK in
-- place, so `assets` is rebuilt (create, copy, drop, rename) with every row and column it had. The
-- runner does not enforce foreign keys while it migrates (`migrate.ts`), so the rows that point at
-- `assets` (`assets.source_asset_id`, `generations.final_asset_id`/`poster_asset_id`,
-- `generation_outputs.asset_id`, `characters.image_asset_id`, `motions.source_asset_id`) point at
-- the new table once it is renamed; `foreign_key_check` then finds them all. `assets` has no index
-- or trigger besides its keys.
CREATE TABLE assets_next (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'image', 'poster', 'text')),
  role TEXT NOT NULL CHECK (role IN ('upload', 'trimmed', 'sample', 'provider_output', 'final', 'poster')),
  -- The upload a trimmed asset was cut from, the video a poster was cut from.
  source_asset_id TEXT REFERENCES assets (id),
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  fps REAL,
  has_audio INTEGER CHECK (has_audio IN (0, 1)),
  license_ref TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO assets_next (rowid, id, sha256, kind, role, source_asset_id, path, mime, bytes, width,
  height, duration_ms, fps, has_audio, license_ref, created_at)
SELECT rowid, id, sha256, kind, role, source_asset_id, path, mime, bytes, width, height,
  duration_ms, fps, has_audio, license_ref, created_at
FROM assets
ORDER BY rowid;

DROP TABLE assets;

ALTER TABLE assets_next RENAME TO assets;
