import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

// `src/server/db.server.ts` opens its connection when it loads, so a test that reaches it must
// import this module first: the test file then gets its own database outside `data/`.
const directory = mkdtempSync(join(tmpdir(), "open-photon-db-"));

process.env.DATABASE_PATH = join(directory, "test.sqlite");

after(() => rmSync(directory, { force: true, recursive: true }));
