import { Comfy, ComfyError, IdempotencyKeyReuse, type Job, type Output } from "@comfyorg/sdk";
import { z } from "zod";

import { type AssetReference, assetReferenceSchema } from "./comfy-assets.ts";
import { comfyTarget } from "./comfy-target.ts";
import type { WorkflowGraph } from "./workflow-graph.ts";

export type ProviderOutput = Pick<Output, "contentType" | "name" | "sizeBytes" | "toFile">;

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

export const comfyProvider: Provider = {
  job: (id) => sdk().jobs.get(id),
  submit: async (graph, idempotencyKey) =>
    (await sdk().submit(sdk().workflows.fromJson(graph), { idempotencyKey })).id,
  upload: async (path) =>
    assetReferenceSchema.parse(await sdk().assets.fromFile(path).asReference()),
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
