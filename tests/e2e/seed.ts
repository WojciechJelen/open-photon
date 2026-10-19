// Prepares the database of a Playwright run (`playwright.config.ts` runs it before the dev
// server starts). It only ever creates a database: an existing file, such as `data/app.sqlite`,
// is refused, so the tests never depend on (or touch) real generations.
import { existsSync } from "node:fs";

const path = process.env.DATABASE_PATH;

if (!path || existsSync(path)) {
  throw new Error(`The e2e seed needs DATABASE_PATH to name a new file, not ${path ?? "nothing"}`);
}

// Imported after that check: opening the module opens (and migrates, and seeds) the database.
await import("../../src/server/db.server.ts");

console.log(`e2e database ${path}`);
