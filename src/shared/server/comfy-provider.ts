import { Comfy, ComfyError, IdempotencyKeyReuse, type Job, type Output } from "@comfyorg/sdk";
import { z } from "zod";

import { type AssetReference, assetReferenceSchema } from "./comfy-assets.ts";
import { fakeProvider } from "./comfy-provider.fake.ts";
import { comfyTarget, type ProviderTarget, providerTarget } from "./comfy-target.ts";
import type { WorkflowGraph } from "./workflow-graph.ts";

/** One file of a finished job; `type` is Comfy's output kind (`image`, `text`, …) when it says. */
export type ProviderOutput = Pick<Output, "contentType" | "name" | "sizeBytes" | "toFile"> &
  Partial<Pick<Output, "type">>;

export type ProviderJob = Pick<Job, "error" | "events" | "id" | "status"> & {
  getOutputs(nodeId: string): ProviderOutput[];
};

/** What the app asks of Comfy. Tests pass a double; the app uses `comfyProvider`. */
export type Provider = {
  /** The job as Comfy reports it now: the source of truth for its status. */
  job(id: string): Promise<ProviderJob>;
  /** Sends the graph under `idempotencyKey`; resolves to the provider job id. */
  submit(graph: WorkflowGraph, idempotencyKey: string): Promise<string>;
  /** Uploads a file (content-addressed, so a known file is not sent again). */
  upload(path: string): Promise<AssetReference>;
  /**
   * The endpoint this provider reaches (`ProviderTarget`), which a stored job must have been
   * submitted to before it is asked about. A test double without one is never checked.
   */
  target?: () => ProviderTarget;
};

/** How long a Comfy request about a job may take: a submit, a status read. */
const REQUEST_TIMEOUT_MS = 30_000;

const UPLOAD_TIMEOUT_ENV_VAR = "COMFY_UPLOAD_TIMEOUT_MS";

// 128 MiB, the upload limit, at about 1.8 Mbit/s. QA sent 110 MiB to a Runpod proxy in 107 s.
const DEFAULT_UPLOAD_TIMEOUT_MS = 600_000;
const MAX_UPLOAD_TIMEOUT_MS = 3_600_000;

/**
 * How long sending one input file to Comfy may take, hashing and the dedup probe included:
 * `COMFY_UPLOAD_TIMEOUT_MS`, default 10 minutes, from the 30 s a job request gets to an hour. A
 * generation holds its place in flight while its files upload. `comfy-boot.ts` checks it at
 * startup.
 */
export function uploadTimeoutMs(env: Record<string, string | undefined>) {
  const value = env[UPLOAD_TIMEOUT_ENV_VAR]?.trim();

  if (!value) {
    return DEFAULT_UPLOAD_TIMEOUT_MS;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < REQUEST_TIMEOUT_MS || parsed > MAX_UPLOAD_TIMEOUT_MS) {
    throw new Error(
      `${UPLOAD_TIMEOUT_ENV_VAR} must be a whole number of milliseconds from ${REQUEST_TIMEOUT_MS} to ${MAX_UPLOAD_TIMEOUT_MS}, not "${value}".`,
    );
  }

  return parsed;
}

/**
 * Comfy through the SDK, with two clients for one target: job requests (submit, status) answer
 * within `requestMs`; an upload gets `uploadMs` for the whole file. The SDK takes one timeout per
 * client and none per upload, and its default timeout also bounds a request body's transfer (and
 * undici's inactivity limits), so a large file needs a client of its own. Both send the same key;
 * the SDK reads `COMFY_BASE_URL` itself, which `comfyTarget()` validated with the SDK's own rules
 * at boot.
 */
export function createSdkProvider(
  apiKey: string | undefined,
  { requestMs, uploadMs }: { requestMs: number; uploadMs: number },
): Provider {
  let jobs: Comfy | undefined;
  let uploads: Comfy | undefined;

  const client = () =>
    (jobs ??= new Comfy({ apiKey, clientInfo: "open-photon", timeoutMs: requestMs }));

  const uploadClient = () =>
    (uploads ??= new Comfy({ apiKey, clientInfo: "open-photon", timeoutMs: uploadMs }));

  return {
    job: (id) => client().jobs.get(id),
    submit: async (graph, idempotencyKey) =>
      (await client().submit(client().workflows.fromJson(graph), { idempotencyKey })).id,
    // `fromFile` streams the file from disk. The signal bounds the probe and the transfer
    // together, which the client's timeout bounds one request at a time.
    upload: async (path) =>
      assetReferenceSchema.parse(
        await uploadClient().assets.fromFile(path).asReference(AbortSignal.timeout(uploadMs)),
      ),
  };
}

// `vite build` replaces `import.meta.env.PROD` with `true`; under plain Node (`test:server`, the
// scripts) `import.meta.env` does not exist, and in `vite dev` it is `false`.
const builtServer = import.meta.env?.PROD === true;

/**
 * Which provider `COMFY_PROVIDER` selects: unset (or `comfy`) is Comfy through the SDK; `fake`
 * is the in-process fake (`comfy-provider.fake.ts`) for development and tests, refused by a built
 * server (`npm run build` output, the image) and whenever `NODE_ENV` is `production`. Any other
 * value throws. `comfy-boot.ts` calls it at startup.
 */
export function providerKind(env: Record<string, string | undefined>, built = builtServer) {
  const value = env.COMFY_PROVIDER?.trim() || "comfy";

  if (value !== "comfy" && value !== "fake") {
    throw new Error(`COMFY_PROVIDER must be "comfy" or "fake", not "${value}".`);
  }

  if (value === "fake" && (built || env.NODE_ENV === "production")) {
    throw new Error(
      "COMFY_PROVIDER=fake is for development and tests only; a production server refuses it.",
    );
  }

  return value;
}

let selected: Provider | undefined;

function selectedProvider() {
  selected ??=
    providerKind(process.env) === "fake"
      ? fakeProvider
      : createSdkProvider(comfyTarget().apiKey, {
          requestMs: REQUEST_TIMEOUT_MS,
          uploadMs: uploadTimeoutMs(process.env),
        });

  return selected;
}

/** The provider `COMFY_PROVIDER` selects (`providerKind`), resolved on first use. */
export const comfyProvider: Provider = {
  job: (id) => selectedProvider().job(id),
  submit: (graph, idempotencyKey) => selectedProvider().submit(graph, idempotencyKey),
  target: providerTarget,
  upload: (path) => selectedProvider().upload(path),
};

type ProviderError = {
  code: "provider_rejected" | "provider_unreachable" | "timeout" | "unknown";
  /** True when Comfy certainly did not accept the request: it answered no, or never got it. */
  refused: boolean;
  message: string;
};

// Node's fetch fails with a TypeError whose cause says why. These causes mean no connection was
// made, so no request reached Comfy: a refused or unreachable address, or a port fetch blocks
// outright ("bad port", such as the dead port 1 used for checks).
const connectionFailureSchema = z.object({
  cause: z.union([
    z.object({
      code: z.enum([
        "ECONNREFUSED",
        "ENOTFOUND",
        "EAI_AGAIN",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "UND_ERR_CONNECT_TIMEOUT",
      ]),
    }),
    z.object({ message: z.literal("bad port") }).transform(({ message }) => ({ code: message })),
  ]),
});

/** Maps an error thrown by a Comfy call to the `error_code` a failed or unknown row stores. */
export function providerError(cause: unknown): ProviderError {
  if (cause instanceof IdempotencyKeyReuse) {
    // Comfy has seen this key: the job it named may exist.
    return { code: "unknown", message: cause.message, refused: false };
  }

  if (cause instanceof ComfyError && cause.httpStatus !== undefined && cause.httpStatus < 500) {
    return {
      code: "provider_rejected",
      message: `Comfy refused the request (${cause.code ?? cause.httpStatus}): ${cause.message}`,
      refused: true,
    };
  }

  if (cause instanceof Error && cause.name === "TimeoutError") {
    return { code: "timeout", message: "Comfy did not answer in time.", refused: false };
  }

  const connection = connectionFailureSchema.safeParse(cause);

  if (cause instanceof TypeError && connection.success) {
    return {
      code: "provider_unreachable",
      message: `Could not connect to Comfy (${connection.data.cause.code}).`,
      refused: true,
    };
  }

  return {
    code: "unknown",
    message: cause instanceof Error ? cause.message : "Comfy failed in an unexpected way.",
    refused: false,
  };
}
