import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const directory = ".output/public";
const hits = [];
let checked = 0;

async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);

    if (entry.isDirectory()) {
      await scan(file);
    } else {
      checked++;
      const bytes = await readFile(file);

      if (
        bytes.includes(Buffer.from("COMFY")) ||
        bytes.includes(Buffer.from("spike-build-canary"))
      ) {
        hits.push(file);
      }
    }
  }
}

await scan(directory);

assert.deepEqual(hits, [], "Server configuration or a build credential reached client output");

console.log(`Client secret check passed: ${checked} files, no credential names or canary values.`);
