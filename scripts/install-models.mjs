import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { discoverWorkflows } from "../src/shared/server/comfy-workflows.ts";
import { aggregateModelsLocks, workflowModelsLock } from "../src/shared/server/models-lock.ts";
import { workflowGraphSchema } from "../src/shared/server/workflow-graph.ts";

const args = process.argv.slice(2);
const verifyOnly = args.includes("--verify-only");
const directory = args.find((arg) => arg !== "--verify-only");

if (!directory)
  throw new Error("Usage: node scripts/install-models.mjs /path/to/ComfyUI/models [--verify-only]");

// Every feature's models.lock (the one beside its runtime workflows), merged; a workflow that loads
// models without a lock, or a file two features pin differently, stops here, before any download.
const locks = new Map();

for (const workflow of discoverWorkflows()) {
  const graph = workflowGraphSchema.parse(JSON.parse(readFileSync(workflow.workflowFile, "utf8")));
  const lock = workflowModelsLock(workflow, graph);

  if (lock) locks.set(workflow.lockFile, { feature: workflow.feature, lock });
}

const models = aggregateModelsLocks([...locks.values()]);

async function hashFile(path) {
  const hash = createHash("sha256");

  await pipeline(createReadStream(path), hash);

  return hash.digest("hex");
}

for (const model of models) {
  const destination = join(directory, model.directory, model.file);
  let existing;

  try {
    existing = await hashFile(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (existing === model.sha256) {
    console.log(`Verified ${model.file}`);
    continue;
  }

  if (existing !== undefined || verifyOnly)
    throw new Error(`Missing or mismatched model: ${destination}`);

  console.log(`Downloading ${model.file}`);
  await mkdir(join(directory, model.directory), { recursive: true });
  const temporary = `${destination}.partial`;
  const hash = createHash("sha256");

  try {
    const response = await fetch(model.url, { signal: AbortSignal.timeout(3_600_000) });

    if (!response.ok || !response.body)
      throw new Error(`Model download failed: HTTP ${response.status}`);

    const verify = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(temporary));

    if (hash.digest("hex") !== model.sha256) throw new Error(`SHA-256 mismatch: ${model.file}`);

    await rename(temporary, destination);
    console.log(`Verified ${model.file}`);
  } finally {
    await rm(temporary, { force: true });
  }
}
