-- docs/mvp-implementation-plan.md §7: the motion library, the sample driving clips a user picks
-- from. Every motion here is a sample; an uploaded clip stays a plain video asset. The clip is
-- 3–8 s already, so it is used as stored.

CREATE TABLE motions (
  id TEXT PRIMARY KEY,
  -- The seed upserts on it.
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source_asset_id TEXT NOT NULL REFERENCES assets (id),
  license TEXT NOT NULL,
  attribution TEXT NOT NULL,
  created_at TEXT NOT NULL
);
