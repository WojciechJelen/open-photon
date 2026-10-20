import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

// `src/shared/server/db.server.ts` opens its connection when it loads, so a test that reaches it must
// import this module first: the test file then gets its own database outside `data/`.
const directory = mkdtempSync(join(tmpdir(), "open-photon-db-"));

process.env.DATABASE_PATH = join(directory, "test.sqlite");

after(() => rmSync(directory, { force: true, recursive: true }));

/**
 * Mints an access code for `max` generations in this test file's database with
 * `scripts/mint-code.mjs`, as an operator does, and returns the code it prints. The database must
 * be open (migrated) already.
 */
export function mintCode(max: number) {
  return execFileSync(process.execPath, ["scripts/mint-code.mjs", "test", String(max)], {
    encoding: "utf8",
  }).trim();
}
