-- The photoshoot feature (src/features/photoshoot/server/repository.ts): a photoshoot is one
-- character photographed in one setting, four shots, each its own generation of the shared image
-- edit workflow, admitted at once by the generation service (`submitMany`, which stores the
-- generations). These tables only name the session and point at its generations, in order; they
-- never hold a status of their own.

-- One photoshoot per request key (the client's UUID, also `submitMany`'s `requestKey`): the same
-- request again finds this row and stores nothing. `setting` is a catalog id of
-- `src/features/photoshoot/settings.ts`; the prompts each shot rendered are in its recipe.
CREATE TABLE photoshoots (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE CHECK (length(request_key) BETWEEN 1 AND 80),
  access_code_id TEXT NOT NULL REFERENCES access_codes (id),
  character_id TEXT NOT NULL REFERENCES characters (id),
  setting TEXT NOT NULL CHECK (length(setting) BETWEEN 1 AND 40),
  created_at TEXT NOT NULL
);

CREATE INDEX photoshoots_recent ON photoshoots (created_at DESC, id DESC);

-- A photoshoot's shots in order (`position` from 0, also the shot of the setting): the generation
-- each was admitted as (new, or an existing one with the same recipe, `reused`). A retry is the
-- shared service's child of a failed generation (`generations.parent_id`), which a read follows.
CREATE TABLE photoshoot_items (
  photoshoot_id TEXT NOT NULL REFERENCES photoshoots (id),
  position INTEGER NOT NULL CHECK (position >= 0),
  generation_id TEXT NOT NULL REFERENCES generations (id),
  reused INTEGER NOT NULL CHECK (reused IN (0, 1)),
  PRIMARY KEY (photoshoot_id, position)
);

CREATE INDEX photoshoot_items_generation ON photoshoot_items (generation_id);
