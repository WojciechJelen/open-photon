-- Shots & Angles (src/features/angles/server/repository.ts): an angle set is one library
-- character seen from several camera angles, one `angle-view` generation per view, admitted at
-- once by the generation service (`submitMany`, which stores the generations). These tables only
-- name the set and point at its generations, in order; they never hold a status of their own.

-- One set per request key (the client's UUID, also `submitMany`'s `requestKey`): the same request
-- again finds this row and stores nothing. `seed` is the seed every view of the set renders with.
CREATE TABLE angle_sets (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE CHECK (length(request_key) BETWEEN 1 AND 80),
  access_code_id TEXT NOT NULL REFERENCES access_codes (id),
  character_id TEXT NOT NULL REFERENCES characters (id),
  seed INTEGER NOT NULL CHECK (seed >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX angle_sets_recent ON angle_sets (created_at DESC, id DESC);

-- A set's views in order (`position` from 0): the view and the generation it was admitted as (new,
-- or an existing one with the same recipe, `reused`). A retry is the shared service's child of a
-- failed generation (`generations.parent_id`), which a read follows; the item keeps its first one.
CREATE TABLE angle_set_items (
  set_id TEXT NOT NULL REFERENCES angle_sets (id),
  position INTEGER NOT NULL CHECK (position >= 0),
  view TEXT NOT NULL CHECK (view IN ('front', 'three-quarter', 'profile', 'close-up')),
  generation_id TEXT NOT NULL REFERENCES generations (id),
  reused INTEGER NOT NULL CHECK (reused IN (0, 1)),
  PRIMARY KEY (set_id, position),
  UNIQUE (set_id, view)
);

CREATE INDEX angle_set_items_generation ON angle_set_items (generation_id);

-- The library character a view's image was saved as (the user's "Save to library", through the
-- characters API's `createFromGeneration`, idempotent per generation), so the set shows it.
CREATE TABLE angle_view_characters (
  generation_id TEXT PRIMARY KEY REFERENCES generations (id),
  character_id TEXT NOT NULL REFERENCES characters (id)
);
