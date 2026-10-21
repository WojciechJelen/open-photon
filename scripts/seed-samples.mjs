// Seeds the sample characters and motions of src/features/motionTransfer/samples/*/manifest.json into DATABASE_PATH (default
// data/app.sqlite). Opening the database does it: db.server.ts applies the migrations, then
// upserts the samples, as the server does on its first query. Running it again changes nothing.
import { database } from "../src/shared/server/db.server.ts";

const count = (sql) => database.prepare(`SELECT count(*) AS count FROM ${sql}`).get().count;

console.log(
  `${count("characters WHERE is_sample = 1")} sample characters, ${count("motions")} sample motions`,
);
