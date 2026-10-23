import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { type ComfyEvent, IdempotencyKeyReuse, type Progress } from "@comfyorg/sdk";
import { z } from "zod";

import type { AssetReference } from "./comfy-assets.ts";
import type { Provider, ProviderJob, ProviderOutput } from "./comfy-provider.ts";
import type { WorkflowGraph } from "./workflow-graph.ts";

/**
 * What a fake job does, chosen per submit (`scenarioFor`):
 * - `success`: runs (progress 25/50/75 %) and succeeds; every `Save*Video` node outputs
 *   `tests/fixtures/fake-output.mp4`, every `SaveImage`/`PreviewImage` node
 *   `tests/fixtures/fake-output.png`, every `SaveText` node the text file
 *   `tests/fixtures/fake-output.txt` (as Comfy's jobs API reports one: type `file`, no content
 *   type, a `.txt` name).
 * - `provider_failed`: runs (progress 50 %) and fails, as a job Comfy could not finish.
 * - `ambiguous`: Comfy accepts the job (it then succeeds like `success`), but the submit call
 *   throws a timeout, so the app cannot know it was accepted.
 */
const fakeScenarios = ["success", "provider_failed", "ambiguous"] as const;

type FakeScenario = (typeof fakeScenarios)[number];

const fakeMedia = ["image", "video", "text"] as const;

type FakeMedia = (typeof fakeMedia)[number];

/** A fake job: its output nodes, its scenario and when it was submitted (epoch ms). */
type FakeJob = {
  id: string;
  outputs: Array<[nodeId: string, media: FakeMedia]>;
  scenario: FakeScenario;
  submittedAt: number;
};

// What a fake job id carries after its key's hash, so a restarted server (whose fake is new) can
// still be asked about a job the stopped one accepted.
const fakeJobSchema = z.object({
  outputs: z.array(z.tuple([z.string(), z.enum(fakeMedia)])),
  scenario: z.enum(fakeScenarios),
  submittedAt: z.int().nonnegative(),
});

/** The job a fake job id describes (`createFakeProvider`'s `submit`), `null` for any other id. */
function readJobId(id: string): FakeJob | null {
  const match = /^fake-[0-9a-f]{32}\.([A-Za-z0-9_-]+)$/.exec(id);

  if (!match?.[1]) {
    return null;
  }

  try {
    const described = fakeJobSchema.safeParse(
      JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")),
    );

    return described.success ? { id, ...described.data } : null;
  } catch {
    return null;
  }
}

// Resolved from the working directory, like the workflows; the fake runs from a checkout only.
const fixtures = {
  image: { contentType: "image/png", path: resolve("tests/fixtures/fake-output.png") },
  text: { contentType: "", path: resolve("tests/fixtures/fake-output.txt") },
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
  const outputs: FakeJob["outputs"] = [];

  for (const [nodeId, node] of Object.entries(graph)) {
    if (/^Save\w*Video$/.test(node.class_type)) {
      outputs.push([nodeId, "video"]);
    } else if (node.class_type === "SaveImage" || node.class_type === "PreviewImage") {
      outputs.push([nodeId, "image"]);
    } else if (node.class_type === "SaveText") {
      outputs.push([nodeId, "text"]);
    }
  }

  return outputs;
}

function fixtureOutput(media: FakeMedia) {
  const fixture = fixtures[media];

  const output: ProviderOutput = {
    contentType: fixture.contentType,
    name: basename(fixture.path),
    sizeBytes: statSync(fixture.path).size,
    toFile: async (path) => {
      await copyFile(fixture.path, path);

      return path;
    },
    type: media === "text" ? "file" : media,
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

/**
 * `COMFY_FAKE_STEP_MS` (default 250) between a fake job's events, counted from its submit: a job
 * is `running` until its last event is due, then `succeeded` (or `failed`), so a page can show
 * progress and a server polling it sees it take that long.
 */
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

  const step = stepMs();
  const ended = Date.now() >= job.submittedAt + script.length * step;
  const outputs = new Map(job.outputs);

  return {
    error:
      failed && ended
        ? { code: "fake_failure", message: "The fake provider failed this job on purpose." }
        : null,
    async *events(signal) {
      for (const [index, event] of script.entries()) {
        const due = job.submittedAt + (index + 1) * step;

        await delay(Math.max(0, due - Date.now()), undefined, { signal });
        yield event;
      }
    },
    getOutputs: (nodeId) => {
      const media = failed || !ended ? undefined : outputs.get(nodeId);

      return media ? [fixtureOutput(media)] : [];
    },
    id: job.id,
    status: ended ? (failed ? "failed" : "succeeded") : "running",
  };
}

/** A deterministic stand-in for Comfy, with the number of calls each method received. */
type FakeProvider = Provider & {
  readonly calls: { job: number; submit: number; upload: number };
  /** The id of the job a submit with `idempotencyKey` created, even one whose call threw. */
  jobIdFor(idempotencyKey: string): string | undefined;
};

/**
 * A provider that never leaves the process (`COMFY_PROVIDER=fake`, `comfy-provider.ts`): uploads
 * are named by the file's hash, and a submit's job id by its idempotency key, followed by what the
 * job is (its outputs, scenario and submit time), so a restarted server can still follow a job
 * the stopped one submitted. Keys are single-use, as on Comfy, while the process lives: a second
 * submit with a key already seen throws the SDK's `IdempotencyKeyReuse` (422) and leaves the
 * first job as it was.
 */
function createFakeProvider() {
  const jobs = new Map<string, FakeJob>();

  const keyHash = (idempotencyKey: string) =>
    createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);

  const provider: FakeProvider = {
    calls: { job: 0, submit: 0, upload: 0 },
    job: (id) => {
      provider.calls.job += 1;
      const job = readJobId(id);

      return job
        ? Promise.resolve(fakeJobHandle(job))
        : Promise.reject(new Error(`The fake provider has no job ${id}.`));
    },
    jobIdFor: (idempotencyKey) => jobs.get(keyHash(idempotencyKey))?.id,
    submit: async (graph, idempotencyKey) => {
      provider.calls.submit += 1;
      const hash = keyHash(idempotencyKey);

      if (jobs.has(hash)) {
        throw new IdempotencyKeyReuse(
          `The fake provider has already seen idempotency key ${idempotencyKey}.`,
          { code: "idempotency_key_reuse", httpStatus: 422 },
        );
      }

      const scenario = scenarioFor(graph);
      const described = { outputs: outputNodes(graph), scenario, submittedAt: Date.now() };
      const id = `fake-${hash}.${Buffer.from(JSON.stringify(described)).toString("base64url")}`;

      jobs.set(hash, { id, ...described });

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
