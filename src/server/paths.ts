import { dirname, resolve } from "node:path";

/** The SQLite file: `DATABASE_PATH`, by default `data/app.sqlite` under the working directory. */
export function databasePath() {
  return resolve(process.env.DATABASE_PATH ?? "data/app.sqlite");
}

/** Content-addressed files (`<sha256>.<ext>`) of the `assets` table, next to the database. */
export function assetsDirectory() {
  return resolve(dirname(databasePath()), "assets");
}
