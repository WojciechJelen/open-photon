-- The storyboard feature (src/features/storyboard/server/repository.ts): one library character in
-- four ordered scene cards, each card rendered by generations of its own through the generation
-- service. These tables hold the storyboard's text and point at its generations; they never hold
-- a status of their own and never write a generation.

-- One storyboard per request key (the client's UUID for `POST /api/storyboards`): the same
-- request again finds this row and stores nothing. `seed` is what every card's first generation
-- renders with, so the four share their noise; `style` is the look every card's prompt asks for
-- (`reference`: the reference image's own). `scenes_generation_id` is the text model's split
-- of `sequence` into four scenes (`storyboard-scenes`), null when the scenes were written by hand.
CREATE TABLE storyboards (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE CHECK (length(request_key) BETWEEN 1 AND 80),
  access_code_id TEXT NOT NULL REFERENCES access_codes (id),
  character_id TEXT NOT NULL REFERENCES characters (id),
  title TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 80),
  sequence TEXT NOT NULL CHECK (length(sequence) BETWEEN 1 AND 1000),
  seed INTEGER NOT NULL CHECK (seed >= 0),
  style TEXT NOT NULL CHECK (style IN ('reference', 'realistic', 'stylized-3d', 'illustration', 'anime')),
  scenes_generation_id TEXT REFERENCES generations (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX storyboards_recent ON storyboards (updated_at DESC, id DESC);

-- A card's description as last saved (`position` 0–3). NULL until the user saves one: a read then
-- shows the split's scene for that position.
CREATE TABLE storyboard_cards (
  storyboard_id TEXT NOT NULL REFERENCES storyboards (id),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 3),
  description TEXT CHECK (description IS NULL OR length(description) <= 1000),
  PRIMARY KEY (storyboard_id, position)
);

-- Every generation a card was rendered as, newest last: the card's current one is its latest
-- (followed through a failed one's shared retry, `generations.parent_id`). Regenerating one card
-- adds a row for that card only, so the others keep theirs. `request_key` is the client's UUID for
-- `POST /api/storyboards/:id/generations`, the same for every card one request rendered: the same
-- request again finds its rows and stores nothing. `description` and `seed` are what it rendered.
CREATE TABLE storyboard_card_generations (
  storyboard_id TEXT NOT NULL REFERENCES storyboards (id),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 3),
  generation_id TEXT NOT NULL REFERENCES generations (id),
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 1 AND 80),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
  seed INTEGER NOT NULL CHECK (seed >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (storyboard_id, position, request_key)
);

CREATE INDEX storyboard_card_generations_card
  ON storyboard_card_generations (storyboard_id, position, created_at);

CREATE INDEX storyboard_card_generations_request ON storyboard_card_generations (request_key);
