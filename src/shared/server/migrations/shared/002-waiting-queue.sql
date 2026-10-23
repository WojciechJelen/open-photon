-- The durable waiting queue (src/shared/server/generation/dispatcher.ts): a generation admitted
-- while every place in flight is taken is stored `waiting` (no provider job, its access code's
-- count reserved) until the dispatcher claims it (`waiting → preparing`); a waiting row can be
-- `cancelled`, which gives the count back. SQLite cannot change a CHECK in place, so the table is
-- rebuilt (create, copy, drop, rename) with every row, index and trigger it had. The runner does
-- not enforce foreign keys while it migrates (`migrate.ts`), so the rows of other tables that
-- point at `generations` (`characters.generation_id`, `generation_outputs.generation_id`, a child's
-- `parent_id`) point at the new table once it is renamed; `foreign_key_check` then finds them all.
CREATE TABLE generations_next (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES generations (id),
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
  -- The endpoint the job runs on (`shared/001-generation-outputs.sql`).
  target_origin TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'waiting', 'preparing', 'queued', 'running', 'finalizing', 'done', 'failed', 'unknown',
      'cancelled'
    )
  ),
  progress INTEGER CHECK (progress BETWEEN 0 AND 100),
  error_code TEXT,
  error_message TEXT,
  finalize_attempts INTEGER NOT NULL DEFAULT 0,
  finalize_attempted_at TEXT,
  final_asset_id TEXT REFERENCES assets (id),
  poster_asset_id TEXT REFERENCES assets (id),
  share_slug TEXT UNIQUE,
  is_prerendered INTEGER NOT NULL DEFAULT 0 CHECK (is_prerendered IN (0, 1)),
  access_code_id TEXT,
  created_at TEXT NOT NULL,
  -- When a process took the row out of the queue to submit it, and which one (pid + random).
  claimed_at TEXT,
  claimed_by TEXT,
  -- When the graph was handed to the provider (`markSubmitting`): from then on a job may exist.
  submit_started_at TEXT,
  submitted_at TEXT,
  finished_at TEXT,
  -- The client's key for the request that made the row (`<key>` for one generation,
  -- `<key>#<index>` for an item of a multi-item request, whose `batch_key` is `<key>`): the same
  -- request again returns this row instead of making another.
  request_key TEXT,
  batch_key TEXT,
  -- A job is queued, running or finished only under a stored provider job id.
  CHECK (
    provider_job_id IS NOT NULL
    OR status IN ('waiting', 'preparing', 'failed', 'unknown', 'cancelled')
  )
);

-- A `preparing` row the flat-only server left after its uploads has no `submit_started_at` (it
-- recorded `provider_inputs` just before the submit): it may have reached the provider, so it is
-- marked as such and recovers to `unknown`, never back to `waiting`.
INSERT INTO generations_next (rowid, id, parent_id, motion_id, character_id, workflow_id,
  workflow_version, recipe, recipe_hash, idempotency_key, provider_job_id, provider_inputs, target,
  target_origin, status, progress, error_code, error_message, finalize_attempts,
  finalize_attempted_at, final_asset_id, poster_asset_id, share_slug, is_prerendered,
  access_code_id, created_at, submit_started_at, submitted_at, finished_at)
SELECT rowid, id, parent_id, motion_id, character_id, workflow_id, workflow_version, recipe,
  recipe_hash, idempotency_key, provider_job_id, provider_inputs, target, target_origin, status,
  progress, error_code, error_message, finalize_attempts, finalize_attempted_at, final_asset_id,
  poster_asset_id, share_slug, is_prerendered, access_code_id, created_at,
  CASE
    WHEN status = 'preparing' AND provider_inputs IS NOT NULL
      THEN coalesce(submit_started_at, created_at)
    ELSE submit_started_at
  END,
  submitted_at, finished_at
FROM generations
ORDER BY rowid;

DROP TABLE generations;

ALTER TABLE generations_next RENAME TO generations;

-- The indexes of `001-assets-generations.sql` and `007-final-review.sql`.
CREATE INDEX generations_recipe_hash_status ON generations (recipe_hash, status);

CREATE INDEX generations_shared_source ON generations (recipe ->> '$.inputs.driving_video_sha256')
WHERE status = 'done' AND share_slug IS NOT NULL;

-- The dispatcher's claim: the oldest `waiting` row (and the in-flight count beside it).
CREATE INDEX generations_status_created ON generations (status, created_at);

-- One row per request key and workflow.
CREATE UNIQUE INDEX generations_request_key ON generations (workflow_id, request_key)
WHERE request_key IS NOT NULL;

-- The triggers of `006-access-codes.sql`, unchanged: an inserted row (a `waiting` one too) counts
-- for its access code; one that fails before the provider took it gives the count back.
CREATE TRIGGER access_codes_count_generation AFTER INSERT ON generations
WHEN NEW.access_code_id IS NOT NULL
BEGIN
  UPDATE access_codes SET used = used + 1 WHERE id = NEW.access_code_id;
END;

CREATE TRIGGER access_codes_return_generation AFTER UPDATE OF status ON generations
WHEN OLD.status = 'preparing' AND NEW.status = 'failed' AND NEW.access_code_id IS NOT NULL
BEGIN
  UPDATE access_codes SET used = used - 1 WHERE id = NEW.access_code_id;
END;

-- A waiting row that is cancelled never reached the provider: its count comes back too. An
-- `unknown` row never gives it back (the provider may have taken the job).
CREATE TRIGGER access_codes_return_cancelled AFTER UPDATE OF status ON generations
WHEN OLD.status = 'waiting' AND NEW.status = 'cancelled' AND NEW.access_code_id IS NOT NULL
BEGIN
  UPDATE access_codes SET used = used - 1 WHERE id = NEW.access_code_id;
END;
