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

let client: Comfy | undefined;

function sdk() {
  // The key is passed explicitly; the SDK reads `COMFY_BASE_URL` itself, which `comfyTarget()`
  // validated with the SDK's own rules at boot.
  client ??= new Comfy({
    apiKey: comfyTarget().apiKey,
    clientInfo: "open-photon",
    timeoutMs: 30_000,
  });

  return client;
}

const sdkProvider: Provider = {
  job: (id) => sdk().jobs.get(id),
  submit: async (graph, idempotencyKey) =>
    (await sdk().submit(sdk().workflows.fromJson(graph), { idempotencyKey })).id,
  upload: async (path) =>
    assetReferenceSchema.parse(await sdk().assets.fromFile(path).asReference()),
};

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
  selected ??= providerKind(process.env) === "fake" ? fakeProvider : sdkProvider;

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
