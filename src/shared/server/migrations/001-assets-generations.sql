-- The data model of docs/mvp-implementation-plan.md §7: assets and generations.
-- motions, characters and access_codes arrive with their own migrations, so the
-- generations columns that point at them carry no foreign key here.

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'image', 'poster')),
  role TEXT NOT NULL CHECK (role IN ('upload', 'trimmed', 'sample', 'provider_output', 'final', 'poster')),
  -- The upload a trimmed asset was cut from.
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

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES generations (id),
  kind TEXT NOT NULL CHECK (kind IN ('render', 'character')),
  motion_id TEXT,
  character_id TEXT,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  recipe TEXT NOT NULL CHECK (json_valid(recipe)),
  recipe_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_job_id TEXT UNIQUE,
  provider_inputs TEXT CHECK (provider_inputs IS NULL OR json_valid(provider_inputs)),
  target TEXT NOT NULL CHECK (target IN ('cloud', 'selfhost')),
  status TEXT NOT NULL CHECK (
    status IN ('preparing', 'queued', 'running', 'finalizing', 'done', 'failed', 'unknown')
  ),
  progress INTEGER CHECK (progress BETWEEN 0 AND 100),
  error_code TEXT,
  error_message TEXT,
  finalize_attempts INTEGER NOT NULL DEFAULT 0,
  output_asset_id TEXT REFERENCES assets (id),
  final_asset_id TEXT REFERENCES assets (id),
  poster_asset_id TEXT REFERENCES assets (id),
  share_slug TEXT UNIQUE,
  is_prerendered INTEGER NOT NULL DEFAULT 0 CHECK (is_prerendered IN (0, 1)),
  access_code_id TEXT,
  client_hash TEXT,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  finished_at TEXT,
  -- A job is queued, running or finished only under a stored provider job id.
  CHECK (provider_job_id IS NOT NULL OR status IN ('preparing', 'failed', 'unknown'))
);

CREATE INDEX generations_recipe_hash_status ON generations (recipe_hash, status);

-- The spike's table; migration 003 drops it.
CREATE TABLE IF NOT EXISTS renders (
  id TEXT PRIMARY KEY,
  provider_job_id TEXT UNIQUE,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  workflow_json TEXT CHECK (workflow_json IS NULL OR json_valid(workflow_json))
);
