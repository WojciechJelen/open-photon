import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

// A stand-in for a self-hosted Comfy (the comfy-api-proxy's `/api/v2` jobs and assets API) that
// renders nothing, for `scripts/verify-packaged-restart.mjs`: the packaged app refuses the
// in-process fake provider (`COMFY_PROVIDER=fake`), so its restart is checked against this one.
// It keeps its jobs in memory, so it must outlive the app it serves. Every job outputs the PNG at
// `STUB_OUTPUT_PNG` from the graph's `SaveImage` nodes.
//
// - `POST /api/v2/jobs` records the submit (idempotency key and the graph as JSON text) and
//   answers 201 with the job; a key it has seen before is a 422 `idempotency_key_reuse`, as the
//   API documents. A graph that holds `[stub:hang]` is recorded and never answered, as if the app
//   stopped mid-submit.
// - `GET /api/v2/jobs/:id`: `succeeded` with outputs, or `running` while the stub holds jobs and
//   the graph holds `[stub:hold]`.
// - `GET /api/v2/assets/:id/content`: the PNG, or a 500 while downloads fail.
// - `GET /stub/state` reports `{ hold, failDownloads, submits }`; `POST /stub/state` with a JSON
//   `{ hold?, failDownloads? }` changes them.

const port = Number(process.env.STUB_PORT ?? 8188);
const png = readFileSync(process.env.STUB_OUTPUT_PNG ?? "/stub/output.png");
const state = { failDownloads: false, hold: true, submits: [] };
const jobs = new Map();
const seenKeys = new Set();

function view(job, origin) {
  const done = !(state.hold && job.held);
  const now = new Date().toISOString();

  return {
    completed_at: done ? now : null,
    created_at: job.createdAt,
    error: null,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    id: job.id,
    outputs: done
      ? job.saveNodes.map((nodeId) => ({
          content_type: "image/png",
          hash: null,
          id: `${job.id}-${nodeId}`,
          job_id: job.id,
          name: `${job.id}-${nodeId}.png`,
          node_id: nodeId,
          size_bytes: png.length,
          type: "image",
          url: `${origin}/api/v2/assets/${job.id}-${nodeId}/content`,
          url_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }))
      : [],
    progress: null,
    queue_position: null,
    started_at: job.createdAt,
    status: done ? "succeeded" : "running",
    urls: {
      cancel: `/api/v2/jobs/${job.id}/cancel`,
      events: `/api/v2/jobs/${job.id}/events`,
      self: `/api/v2/jobs/${job.id}`,
    },
  };
}

async function body(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function notFound(response) {
  json(response, 404, { error: { code: "not_found", message: "Not found" } });
}

createServer(async (request, response) => {
  const origin = `http://${request.headers.host}`;
  const { pathname } = new URL(request.url ?? "/", origin);

  if (pathname === "/stub/state") {
    if (request.method === "POST") {
      const { failDownloads, hold } = await body(request);

      state.failDownloads = failDownloads ?? state.failDownloads;
      state.hold = hold ?? state.hold;
    }

    return json(response, 200, state);
  }

  if (request.method === "POST" && pathname === "/api/v2/jobs") {
    const { workflow } = await body(request);
    const key = request.headers["idempotency-key"] ?? null;
    const graph = JSON.stringify(workflow);

    state.submits.push({ at: new Date().toISOString(), graph, key });

    if (key && seenKeys.has(key)) {
      return json(response, 422, {
        error: { code: "idempotency_key_reuse", message: `Idempotency key ${key} was used` },
      });
    }

    if (key) {
      seenKeys.add(key);
    }

    if (graph.includes("[stub:hang]")) {
      return;
    }

    const job = {
      createdAt: new Date().toISOString(),
      held: graph.includes("[stub:hold]"),
      id: randomUUID(),
      saveNodes: Object.entries(workflow ?? {})
        .filter(([, node]) => node.class_type === "SaveImage")
        .map(([nodeId]) => nodeId),
    };

    jobs.set(job.id, job);

    return json(response, 201, view(job, origin));
  }

  const jobMatch = /^\/api\/v2\/jobs\/([^/]+)$/.exec(pathname);

  if (request.method === "GET" && jobMatch) {
    const job = jobs.get(decodeURIComponent(jobMatch[1]));

    return job ? json(response, 200, view(job, origin)) : notFound(response);
  }

  const assetMatch = /^\/api\/v2\/assets\/([^/]+)-[^/-]+\/content$/.exec(pathname);

  if (request.method === "GET" && assetMatch && jobs.has(decodeURIComponent(assetMatch[1]))) {
    if (state.failDownloads) {
      return json(response, 500, { error: { code: "internal", message: "Download failed" } });
    }

    response.writeHead(200, { "Content-Length": png.length, "Content-Type": "image/png" });

    return response.end(png);
  }

  notFound(response);
}).listen(port, "0.0.0.0", () => {
  console.info(JSON.stringify({ event: "stub.listening", port }));
});
