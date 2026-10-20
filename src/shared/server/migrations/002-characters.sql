-- docs/mvp-implementation-plan.md §7: a character is a reference image, either generated (the
-- samples, later Klein) or uploaded with the uploader's likeness consent.

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  -- Samples are keyed by slug (the seed upserts on it); uploads have none.
  slug TEXT UNIQUE,
  title TEXT,
  image_asset_id TEXT NOT NULL REFERENCES assets (id),
  origin TEXT NOT NULL CHECK (origin IN ('generated', 'upload')),
  prompt TEXT,
  generation_id TEXT REFERENCES generations (id),
  consent_at TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  created_at TEXT NOT NULL,
  -- An uploaded likeness exists only with consent; a generated one has no one to consent.
  CHECK ((origin = 'upload') = (consent_at IS NOT NULL)),
  CHECK (origin = 'generated' OR (prompt IS NULL AND generation_id IS NULL)),
  CHECK (is_sample = 0 OR (slug IS NOT NULL AND title IS NOT NULL))
);

-- One uploaded character per image: uploading the same file again returns it.
CREATE UNIQUE INDEX characters_upload_image ON characters (image_asset_id) WHERE origin = 'upload';
