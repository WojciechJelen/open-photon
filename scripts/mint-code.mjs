// node scripts/mint-code.mjs <label> <max generations>
//
// Mints an access code in the app's database (`DATABASE_PATH`, by default data/app.sqlite) and
// prints it once: only its SHA-256 is stored, so a lost code cannot be shown again; mint another.
// The app creates and migrates the database when it starts, so start it once first.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [label, max, ...rest] = process.argv.slice(2);

if (!label || label.length > 64 || !max || !/^\d{1,9}$/.test(max) || rest.length > 0) {
  console.error("Usage: node scripts/mint-code.mjs <label, 1-64 characters> <max generations>");
  process.exit(2);
}

const path = resolve(process.env.DATABASE_PATH ?? "data/app.sqlite");

if (!existsSync(path)) {
  console.error(
    `No database at ${path}. Start the app once (it creates it), or set DATABASE_PATH.`,
  );
  process.exit(1);
}

const database = new DatabaseSync(path);

try {
  database.exec("PRAGMA busy_timeout = 5000");

  if (!database.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'access_codes'").get()) {
    throw new Error(`${path} has no access_codes table yet. Start the app once to migrate it.`);
  }

  // 144 random bits, URL-safe: 24 characters.
  const code = randomBytes(18).toString("base64url");

  database
    .prepare(
      `INSERT INTO access_codes (id, code_hash, label, max_generations, created_at)
      VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      createHash("sha256").update(code).digest("hex"),
      label,
      Number(max),
      new Date().toISOString(),
    );

  console.log(code);
} finally {
  database.close();
}
