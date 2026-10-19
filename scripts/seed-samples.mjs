// Seeds the sample characters of samples/characters/manifest.json into DATABASE_PATH (default
// data/spike.sqlite). Opening the database does it: db.server.ts applies the migrations, then
// upserts the samples, as the server does on its first query. Running it again changes nothing.
import { database } from "../src/server/db.server.ts";

const { count } = database
  .prepare("SELECT count(*) AS count FROM characters WHERE is_sample = 1")
  .get();

console.log(`${count} sample characters`);
