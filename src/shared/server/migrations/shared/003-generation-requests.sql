-- What each client request key was answered with (`submit`, `submitMany`): the generation it got,
-- whether that was an existing one (`reused`, never charged), and the access code that asked
-- (another code's request with the key is refused). Every answer is recorded, reused ones too, so
-- the same request again gets the same answer even when its generation was cancelled since; a
-- multi-item request records `<key>#<index>` per item. Resolved before a recipe is prepared.
CREATE TABLE generation_requests (
  workflow_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 1 AND 80),
  access_code_id TEXT,
  generation_id TEXT NOT NULL REFERENCES generations (id),
  reused INTEGER NOT NULL CHECK (reused IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workflow_id, request_key)
);

-- Keys `shared/002-waiting-queue.sql` stored on the rows they made.
INSERT INTO generation_requests (workflow_id, request_key, access_code_id, generation_id, reused,
  created_at)
SELECT workflow_id, request_key, access_code_id, id, 0, created_at
FROM generations WHERE request_key IS NOT NULL;
