// Stitches the side-by-side (`compare`) of every done Motion Transfer take in DATABASE_PATH
// (default data/app.sqlite) that finished before finalize made one, oldest first, and adds it to
// the take's outputs (`deriveForDone`, src/shared/server/generation/finalize.ts). Run by hand:
//   DATABASE_PATH=data/app.sqlite node scripts/backfill-compare.mjs
// It runs FFmpeg on this machine and never calls Comfy. A take whose stitch fails (its driving clip
// is no longer stored) is logged and left as it is; running it again only retries those.
import "../src/app/server.ts";
import { database } from "../src/shared/server/db.server.ts";
import { deriveForDone } from "../src/shared/server/generation/finalize.ts";

const takes = database
  .prepare(
    `SELECT id FROM generations
    WHERE workflow_id = 'motion-transfer' AND status = 'done'
      AND NOT EXISTS (SELECT 1 FROM generation_outputs
        WHERE generation_id = generations.id AND name = 'compare')
    ORDER BY finished_at`,
  )
  .all();

let stitched = 0;

for (const { id } of takes) {
  const added = await deriveForDone(id);
  stitched += added.includes("compare") ? 1 : 0;
  console.log(`${id}: ${added.includes("compare") ? "compare added" : "not stitched"}`);
}

console.log(`${stitched} of ${takes.length} done takes without a side-by-side now have one`);
