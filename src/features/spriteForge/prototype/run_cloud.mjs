// The Sprite Forge prototype's Comfy Cloud runner: uploads the bound files, submits one API graph,
// waits, writes `job.json` and downloads every output to `<outdir>/<node id>/`. A bind sets one
// input: an integer, or a file path, which is uploaded and replaced by its asset reference.
//   node --env-file=.env src/features/spriteForge/prototype/run_cloud.mjs \
//     <graph.json> <outdir> [node:field=path|int ...]
//   node --env-file=.env src/features/spriteForge/prototype/run_cloud.mjs job:<id> <outdir>
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { Comfy } from "@comfyorg/sdk";

const [graphPath, outDir, ...binds] = process.argv.slice(2);

const comfy = new Comfy({
  apiKey: process.env.COMFY_API_KEY,
  clientInfo: "open-photon",
  timeoutMs: 120_000,
});

mkdirSync(outDir, { recursive: true });

const started = Date.now();

let job;

if (graphPath.startsWith("job:")) {
  job = await comfy.jobs.get(graphPath.slice(4));
} else {
  const graph = JSON.parse(readFileSync(graphPath, "utf8"));

  for (const bind of binds) {
    const [target, value] = bind.split("=");
    const [node, field] = target.split(":");

    if (!graph[node]) throw new Error(`no node ${node}`);
    graph[node].inputs[field] = /^-?\d+$/.test(value)
      ? Number(value)
      : await comfy.assets.fromFile(value).asReference();
  }

  job = await comfy.submit(comfy.workflows.fromJson(graph), { idempotencyKey: randomUUID() });
  console.log(`submitted ${job.id}`);
  writeFileSync(
    join(outDir, "job.json"),
    JSON.stringify({ id: job.id, graph: graphPath, binds }, null, 2),
  );
}

await job.wait(45 * 60_000);

const record = {
  id: job.id,
  status: job.status,
  error: job.error,
  graph: graphPath,
  binds,
  wall_s: (Date.now() - started) / 1000,
  started_at: job.startedAt,
  completed_at: job.completedAt,
  run_s: job.startedAt && job.completedAt ? (job.completedAt - job.startedAt) / 1000 : null,
  metrics: job.metrics,
  outputs: job.outputs.map((o) => ({
    node: o.nodeId,
    name: o.name,
    type: o.type,
    bytes: o.sizeBytes,
  })),
};

writeFileSync(join(outDir, "job.json"), JSON.stringify(record, null, 2));

console.log(`${job.status} in ${record.wall_s.toFixed(0)}s, ${job.outputs.length} outputs`);

if (job.status !== "succeeded") {
  console.log(JSON.stringify(job.error));
  process.exit(1);
}

for (const output of job.outputs) {
  const dir = join(outDir, output.nodeId);
  mkdirSync(dir, { recursive: true });
  await output.toFile(join(dir, basename(output.name)));
}

console.log(`downloaded to ${outDir}`);
