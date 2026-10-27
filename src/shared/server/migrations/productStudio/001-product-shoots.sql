-- Product Studio (src/features/productStudio/server/repository.ts): a shoot is one product photo
-- rendered as one or more product shots at once, admitted by the generation service
-- (`submitMany`, which stores the generations). These tables only name the shoot and point at its
-- generations, in order; they never hold a status of their own.

-- One shoot per request key (the client's UUID, also `submitMany`'s `requestKey`): the same
-- request again finds this row and stores nothing. `product_asset_id` is the uploaded photo,
-- `product` what the user said it is, `description` the scene they described (NULL: each
-- preset's own) and `format` the frame every shot of the shoot has.
CREATE TABLE product_shoots (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE CHECK (length(request_key) BETWEEN 1 AND 80),
  access_code_id TEXT NOT NULL REFERENCES access_codes (id),
  product_asset_id TEXT NOT NULL REFERENCES assets (id),
  product TEXT NOT NULL CHECK (length(product) BETWEEN 1 AND 120),
  description TEXT CHECK (description IS NULL OR length(description) BETWEEN 1 AND 400),
  format TEXT NOT NULL CHECK (format IN ('square', 'portrait', 'landscape')),
  created_at TEXT NOT NULL
);

CREATE INDEX product_shoots_recent ON product_shoots (created_at DESC, id DESC);

-- A shoot's shots in order (`position` from 0): the preset each one renders and the generation
-- it was admitted as (new, or an existing one with the same recipe, `reused`). A retry is the
-- shared service's child of a failed generation (`generations.parent_id`), which a read follows;
-- the item keeps its first generation.
CREATE TABLE product_shoot_items (
  shoot_id TEXT NOT NULL REFERENCES product_shoots (id),
  position INTEGER NOT NULL CHECK (position >= 0),
  preset TEXT NOT NULL CHECK (preset IN ('packshot', 'lifestyle', 'advertising')),
  generation_id TEXT NOT NULL REFERENCES generations (id),
  reused INTEGER NOT NULL CHECK (reused IN (0, 1)),
  PRIMARY KEY (shoot_id, position)
);

CREATE INDEX product_shoot_items_generation ON product_shoot_items (generation_id);
