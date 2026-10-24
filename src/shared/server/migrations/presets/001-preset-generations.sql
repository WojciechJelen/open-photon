-- The presets feature's provenance (src/features/presets/server/generate.ts): which preset version
-- a Motion Transfer generation was submitted from. The generation's recipe holds the concrete
-- motion, look and seed it renders; this row says where they came from, kept apart from the recipe
-- so a preset take hashes (and reuses results) like the same take made in the wizard. `preset` is
-- the catalog entry as it was at submission (JSON), so later catalog edits change neither the
-- recipe nor this record; `overrides` what the visitor changed of its look and seed (JSON, `{}`
-- for none). One row per generation, written once.
CREATE TABLE preset_generations (
  generation_id TEXT PRIMARY KEY REFERENCES generations (id),
  preset_id TEXT NOT NULL,
  preset_version INTEGER NOT NULL CHECK (preset_version > 0),
  preset TEXT NOT NULL CHECK (json_valid(preset)),
  overrides TEXT NOT NULL CHECK (json_valid(overrides)),
  created_at TEXT NOT NULL
);
