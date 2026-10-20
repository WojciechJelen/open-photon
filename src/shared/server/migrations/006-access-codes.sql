-- docs/mvp-implementation-plan.md §7: access codes. `scripts/mint-code.mjs <label> <max>` mints
-- one: the code is printed once and only its SHA-256 is stored. A session is bound to its code,
-- so revoking the code (`revoked_at`) ends every session made with it.

CREATE TABLE access_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 64),
  max_generations INTEGER NOT NULL CHECK (max_generations >= 0),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

-- `used` counts the code's generations that Comfy accepted or may have accepted. A generation
-- counts from the moment its row is stored (`generate` refuses a code at its maximum before
-- that), and gives its count back if it fails before Comfy took it (`preparing → failed`: the
-- upload or the submit was refused, or the server stopped before sending it). Reused results
-- create no row and never count.
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
