-- The batches feature (DEV-292, src/features/batches/server/repository.ts): a batch is several
-- variations of one Motion Transfer shot, admitted at once by the generation service
-- (`submitMany`, which stores the generations). These tables only name the batch and point at
-- its generations, in order; they never hold a status of their own.

-- One batch per request key (the client's UUID, also `submitMany`'s `requestKey`, so the
-- generations carry it as `batch_key`): the same request again finds this row and stores nothing.
-- `shot` is the common shot (a Motion Transfer draft snapshot, JSON) and `kind` what varies.
CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE CHECK (length(request_key) BETWEEN 1 AND 80),
  access_code_id TEXT NOT NULL REFERENCES access_codes (id),
  kind TEXT NOT NULL CHECK (kind IN ('seeds', 'characters')),
  shot TEXT NOT NULL CHECK (json_valid(shot)),
  created_at TEXT NOT NULL
);

CREATE INDEX batches_recent ON batches (created_at DESC, id DESC);

-- A batch's items in order (`position` from 0): the generation each one was admitted as (new, or
-- an existing one with the same recipe, `reused`) and what it varies (`variation`, JSON
-- `{ "seed": n }` or `{ "character_id": "…" }`). A retry is the shared service's child of a failed
-- generation (`generations.parent_id`), which a read follows; the item keeps its first generation.
CREATE TABLE batch_items (
  batch_id TEXT NOT NULL REFERENCES batches (id),
  position INTEGER NOT NULL CHECK (position >= 0),
  generation_id TEXT NOT NULL REFERENCES generations (id),
  variation TEXT NOT NULL CHECK (json_valid(variation)),
  reused INTEGER NOT NULL CHECK (reused IN (0, 1)),
  PRIMARY KEY (batch_id, position)
);

CREATE INDEX batch_items_generation ON batch_items (generation_id);
