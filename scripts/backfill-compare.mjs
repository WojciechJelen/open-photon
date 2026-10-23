// Stitches the side-by-side (`compare`) of every done Motion Transfer take in DATABASE_PATH
// (default data/app.sqlite) that finished before finalize made one, oldest first, and adds it to
// the take's outputs (`deriveForDone`, src/shared/server/generation/finalize.ts). Run by hand:
//   DATABASE_PATH=data/app.sqlite node scripts/backfill-compare.mjs
// It runs FFmpeg on this machine and never calls Comfy. A take whose stitch fails (its driving clip
// is no longer stored) is logged and left as it is; running it again only retries those.
// It runs where the repository is, with its node_modules: it imports the server's TypeScript
// sources, which the app image does not ship (of scripts/ it copies only the self-contained
// mint-code.mjs and prerender-samples.mjs). For a deployed database, run it against that
// volume's database and its assets/ beside it, with the app stopped.
import "../src/app/server.ts";
import { COMPARE_OUTPUT } from "../src/features/motionTransfer/server/media/compare.ts";
import { database } from "../src/shared/server/db.server.ts";
import { deriveForDone } from "../src/shared/server/generation/finalize.ts";

const takes = database
  .prepare(
    `SELECT id FROM generations
    WHERE workflow_id = 'motion-transfer' AND status = 'done'
      AND NOT EXISTS (SELECT 1 FROM generation_outputs
        WHERE generation_id = generations.id AND name = ?)
    ORDER BY finished_at`,
  )
  .all(COMPARE_OUTPUT);

let stitched = 0;

for (const { id } of takes) {
  const added = (await deriveForDone(id)).includes(COMPARE_OUTPUT);
  stitched += added ? 1 : 0;
  console.log(`${id}: ${added ? "compare added" : "not stitched"}`);
}

console.log(`${stitched} of ${takes.length} done takes without a side-by-side now have one`);
