-- The characters feature's workspace library (src/features/characters/server/repository.ts). Every
-- existing row keeps its id; the new columns start null.

-- When a user marked the character a favorite; null when it is not one.
ALTER TABLE characters ADD COLUMN favorite_at TEXT;

-- When a user last renamed or (un)favorited it; null until then.
ALTER TABLE characters ADD COLUMN updated_at TEXT;

-- A generated character's workflow and model pins, copied from its generation's recipe when it was
-- saved (JSON `{ workflow: { id, version, sha256 }, models: [...] }`); null for uploads and samples.
ALTER TABLE characters ADD COLUMN provenance TEXT CHECK (provenance IS NULL OR json_valid(provenance));

-- One character per generation: saving the same generation again returns it (`createFromGeneration`),
-- and two concurrent saves cannot both insert. Samples are `generated` without a generation, and
-- NULLs never collide.
CREATE UNIQUE INDEX characters_generation ON characters (generation_id) WHERE origin = 'generated';

-- `isSampleCharacterImage` runs for every public media request.
CREATE INDEX characters_sample_image ON characters (image_asset_id) WHERE is_sample = 1;
