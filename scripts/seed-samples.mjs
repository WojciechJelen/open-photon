// Seeds the sample characters (src/features/characters/samples/characters/manifest.json) and
// motions (src/features/motionTransfer/samples/motions/manifest.json) into DATABASE_PATH (default
// data/app.sqlite): opening the database applies the migrations (db.server.ts), then the composed
// seeders run (src/app/server.ts `seedDatabase`), as the server does at boot. Running it again
// changes nothing.
import { seedDatabase } from "../src/app/server.ts";
import { database } from "../src/shared/server/db.server.ts";

seedDatabase();

const count = (sql) => database.prepare(`SELECT count(*) AS count FROM ${sql}`).get().count;

console.log(
  `${count("characters WHERE is_sample = 1")} sample characters, ${count("motions")} sample motions`,
);
