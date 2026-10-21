-- Every done generation has a share page, /r/<share_slug>: 16 random hex characters (64 bits),
-- given when the row becomes done (`transition` in src/features/motionTransfer/server/generations.ts). This gives one
-- to the rows that were done before share pages existed.
UPDATE generations SET share_slug = lower(hex(randomblob(8)))
WHERE status = 'done' AND share_slug IS NULL;
