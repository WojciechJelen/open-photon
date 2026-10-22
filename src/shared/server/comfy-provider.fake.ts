import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { ComfyEvent, Progress } from "@comfyorg/sdk";

import type { AssetReference } from "./comfy-assets.ts";
import type { Provider, ProviderJob, ProviderOutput } from "./comfy-provider.ts";
import type { WorkflowGraph } from "./workflow-graph.ts";

/**
 * What a fake job does, chosen per submit (`scenarioFor`):
 * - `success`: runs (progress 25/50/75 %) and succeeds; every `Save*Video` node outputs
 *   `tests/fixtures/fake-output.mp4`, every `SaveImage`/`PreviewImage` node
 *   `tests/fixtures/fake-output.png`.
 * - `provider_failed`: runs (progress 50 %) and fails, as a job Comfy could not finish.
 * - `ambiguous`: Comfy accepts the job (it then succeeds like `success`), but the submit call
 *   throws a timeout, so the app cannot know it was accepted.
 */
const fakeScenarios = ["success", "provider_failed", "ambiguous"] as const;

type FakeScenario = (typeof fakeScenarios)[number];

type FakeJob = { id: string; outputs: Map<string, "image" | "video">; scenario: FakeScenario };

// Resolved from the working directory, like the workflows; the fake runs from a checkout only.
const fixtures = {
  image: { contentType: "image/png", path: resolve("tests/fixtures/fake-output.png") },
  video: { contentType: "video/mp4", path: resolve("tests/fixtures/fake-output.mp4") },
};

function isFakeScenario(value: string): value is FakeScenario {
  return fakeScenarios.some((scenario) => scenario === value);
}

function parseScenario(value: string, source: string) {
  if (!isFakeScenario(value)) {
    throw new Error(
      `${source} names an unknown fake scenario "${value}" (${fakeScenarios.join(", ")})`,
    );
  }

  return value;
}

/**
 * The scenario of a submit: a `[fake:<scenario>]` marker in any of the graph's inputs (a prompt,
 * say), else `COMFY_FAKE_SCENARIO`, else `success`. An unknown name throws.
 */
function scenarioFor(graph: WorkflowGraph) {
  const marker = /\[fake:([a-z_]+)\]/.exec(JSON.stringify(graph))?.[1];

  if (marker !== undefined) {
    return parseScenario(marker, "The graph's [fake:…] marker");
  }

  const configured = process.env.COMFY_FAKE_SCENARIO?.trim();

  return configured ? parseScenario(configured, "COMFY_FAKE_SCENARIO") : "success";
}

/** The fixture each output node of `graph` produces, by its class. */
function outputNodes(graph: WorkflowGraph) {
  const outputs = new Map<string, "image" | "video">();

  for (const [nodeId, node] of Object.entries(graph)) {
    if (/^Save\w*Video$/.test(node.class_type)) {
      outputs.set(nodeId, "video");
    } else if (node.class_type === "SaveImage" || node.class_type === "PreviewImage") {
      outputs.set(nodeId, "image");
    }
  }

  return outputs;
}

function fixtureOutput(media: "image" | "video") {
  const fixture = fixtures[media];

  const output: ProviderOutput = {
    contentType: fixture.contentType,
    name: basename(fixture.path),
    sizeBytes: statSync(fixture.path).size,
    toFile: async (path) => {
      await copyFile(fixture.path, path);

      return path;
    },
  };

  return output;
}

function progress(value: number) {
  const event: Progress = {
    currentNode: null,
    currentNodeClass: null,
    kind: "progress",
    message: null,
    nodesDone: null,
    nodesTotal: null,
    step: null,
    steps: null,
    value,
  };

  return event;
}

function statusChange(status: string): ComfyEvent {
  return { kind: "statusChange", queuePosition: null, status };
}

/** `COMFY_FAKE_STEP_MS` (default 250) between a fake job's events, so a page can show progress. */
function stepMs() {
  const configured = Number(process.env.COMFY_FAKE_STEP_MS ?? 250);

  return Number.isFinite(configured) && configured >= 0 ? configured : 250;
}

function fakeJobHandle(job: FakeJob): ProviderJob {
  const failed = job.scenario === "provider_failed";

  const script = failed
    ? [statusChange("running"), progress(0.5), statusChange("failed")]
    : [
        statusChange("running"),
        progress(0.25),
        progress(0.5),
        progress(0.75),
        statusChange("succeeded"),
      ];

  return {
    error: failed
      ? { code: "fake_failure", message: "The fake provider failed this job on purpose." }
      : null,
    async *events(signal) {
      for (const event of script) {
        await delay(stepMs(), undefined, { signal });
        yield event;
      }
    },
    getOutputs: (nodeId) => {
      const media = failed ? undefined : job.outputs.get(nodeId);

      return media ? [fixtureOutput(media)] : [];
    },
    id: job.id,
    status: failed ? "failed" : "succeeded",
  };
}

/** A deterministic stand-in for Comfy, with the number of calls each method received. */
type FakeProvider = Provider & {
  readonly calls: { job: number; submit: number; upload: number };
};

/**
 * A provider that never leaves the process (`COMFY_PROVIDER=fake`, `comfy-provider.ts`): uploads
 * are named by the file's hash, a submit's job id by its idempotency key (the same key returns the
 * same job, as Comfy does), and jobs live in memory, so a restart forgets them.
 */
function createFakeProvider() {
  const jobs = new Map<string, FakeJob>();

  const provider: FakeProvider = {
    calls: { job: 0, submit: 0, upload: 0 },
    job: (id) => {
      provider.calls.job += 1;
      const job = jobs.get(id);

      return job
        ? Promise.resolve(fakeJobHandle(job))
        : Promise.reject(
            new Error(`The fake provider has no job ${id}: its jobs live in memory only.`),
          );
    },
    submit: async (graph, idempotencyKey) => {
      provider.calls.submit += 1;
      const id = `fake-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
      const scenario = jobs.get(id)?.scenario ?? scenarioFor(graph);

      jobs.set(id, { id, outputs: outputNodes(graph), scenario });

      if (scenario === "ambiguous") {
        throw Object.assign(new Error("The fake provider accepted the job, then timed out."), {
          name: "TimeoutError",
        });
      }

      return id;
    },
    upload: async (path) => {
      provider.calls.upload += 1;

      const hash = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");

      const reference: AssetReference = {
        __type: "core/ASSET",
        info: {
          file_path: basename(path),
          hash: `sha256:${hash}`,
          id: `fake-asset-${hash.slice(0, 32)}`,
        },
      };

      return reference;
    },
  };

  return provider;
}

/** The process's fake provider: what `comfyProvider` uses under `COMFY_PROVIDER=fake`. */
export const fakeProvider = createFakeProvider();
