-- Sprite Forge (src/features/spriteForge/server/repository.ts): a sprite set is one library
-- character drawn from five directions, one `sprite-view` generation per direction, admitted at
-- once by the generation service (`submitMany`, which stores the generations); a sprite sheet is
-- one `sprite-sheet` generation forged from a set's done views. These tables only name the set
-- and its sheets and point at their generations; they never hold a status of their own.

-- One set per request key (the client's UUID, also `submitMany`'s `requestKey`): the same request
-- again finds this row and stores nothing. `seed` is the seed every direction renders with.
CREATE TABLE sprite_sets (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE CHECK (length(request_key) BETWEEN 1 AND 80),
  access_code_id TEXT NOT NULL REFERENCES access_codes (id),
  character_id TEXT NOT NULL REFERENCES characters (id),
  seed INTEGER NOT NULL CHECK (seed >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX sprite_sets_recent ON sprite_sets (created_at DESC, id DESC);

-- A set's directions in order (`position` from 0): the direction and the generation it was
-- admitted as (new, or an existing one with the same recipe, `reused`). A retry is the shared
-- service's child of a failed generation (`generations.parent_id`), which a read follows; the
-- row keeps its first one.
CREATE TABLE sprite_set_views (
  set_id TEXT NOT NULL REFERENCES sprite_sets (id),
  position INTEGER NOT NULL CHECK (position >= 0),
  direction TEXT NOT NULL CHECK (direction IN ('s', 'sw', 'w', 'nw', 'n')),
  generation_id TEXT NOT NULL REFERENCES generations (id),
  reused INTEGER NOT NULL CHECK (reused IN (0, 1)),
  PRIMARY KEY (set_id, position),
  UNIQUE (set_id, direction)
);

CREATE INDEX sprite_set_views_generation ON sprite_set_views (generation_id);

-- A sheet forged from a set, one per request key (the client's UUID, also the sheet's
-- `submitMany` key): the facing of each turned view and the takes per direction it was asked
-- for, and the generation it was admitted as; a read follows its retries like a view's.
CREATE TABLE sprite_sheets (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES sprite_sets (id),
  request_key TEXT NOT NULL UNIQUE CHECK (length(request_key) BETWEEN 1 AND 80),
  access_code_id TEXT NOT NULL REFERENCES access_codes (id),
  generation_id TEXT NOT NULL REFERENCES generations (id),
  facing_sw TEXT NOT NULL CHECK (facing_sw IN ('left', 'right')),
  facing_w TEXT NOT NULL CHECK (facing_w IN ('left', 'right')),
  facing_nw TEXT NOT NULL CHECK (facing_nw IN ('left', 'right')),
  takes INTEGER NOT NULL CHECK (takes IN (1, 3)),
  created_at TEXT NOT NULL
);

CREATE INDEX sprite_sheets_recent ON sprite_sheets (set_id, created_at DESC);
