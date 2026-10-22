// Checks that the configured Comfy deployment is reachable and accepts its Cloud key or proxy token:
// `npm run check:comfy` (the environment, then `.env`). One read of a job id that cannot exist,
// at the path the SDK the app uses calls; prints no secrets. Exits 0 only on OK.
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { providerError } from "../src/shared/server/comfy-provider.ts";
import { describeComfyTarget, resolveComfyTarget } from "../src/shared/server/comfy-target.ts";

// What ComfyUI's own `/system_stats` answers; comfy-api-proxy serves only `/api/v2/*`.
const systemStatsSchema = z.object({ system: z.object({ comfyui_version: z.string() }) });

// A Comfy API v2 error body. Any server answers a wrong path 404; only the v2 API says why in this.
const envelopeSchema = z.object({ error: z.object({ code: z.string() }) });

/** Whether `baseUrl` is ComfyUI's native server rather than the v2 API in front of it. */
async function isRawComfyUi(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/system_stats`, {
      signal: AbortSignal.timeout(10_000),
    });

    return response.ok && systemStatsSchema.safeParse(await response.json()).success;
  } catch {
    return false;
  }
}

/** The error code of a v2 error envelope in `response`, if its body is one. */
async function envelopeCode(response) {
  try {
    const envelope = envelopeSchema.safeParse(await response.json());

    return envelope.success ? envelope.data.error.code : undefined;
  } catch {
    return undefined;
  }
}

try {
  const target = resolveComfyTarget(process.env);

  console.log(describeComfyTarget(target));

  // No deployment knows a fresh random id: "not found" is the answer of a working v2 API.
  const response = await fetch(`${target.baseUrl}/api/v2/jobs/${randomUUID()}`, {
    headers: {
      Accept: "application/json",
      ...(target.apiKey && { Authorization: `Bearer ${target.apiKey}` }),
    },
    signal: AbortSignal.timeout(10_000),
  }).catch((error) => {
    const failure = providerError(error);

    throw failure.code === "provider_unreachable"
      ? new Error(`unreachable: ${failure.message}`)
      : error;
  });

  const code = await envelopeCode(response);

  if (response.status === 404 && (code === "not_found" || code === "job_not_found")) {
    console.log("OK: reachable and authorized (an unknown job id is 404 not found)");
  } else if (response.status === 401 || response.status === 403) {
    throw new Error(
      `wrong or missing token: ${target.baseUrl} answered ${response.status}${code ? ` (${code})` : ""}. ` +
        (target.kind === "cloud"
          ? "Set COMFY_API_KEY to a valid Comfy Cloud API key."
          : "Set COMFY_PROXY_TOKEN to the comfy-api-proxy --token."),
    );
  } else if (response.status === 404) {
    // ComfyUI's native server answers 404 for `/api/v2/*`, as does any server at a wrong path.
    if (await isRawComfyUi(target.baseUrl)) {
      throw new Error(
        "this is raw ComfyUI on its native port; run comfy-api-proxy and point COMFY_BASE_URL at it (8189)",
      );
    }

    throw new Error(
      `no Comfy API v2 at ${target.baseUrl}: 404 without an error envelope. ` +
        "Check the URL path and port (a comfy-api-proxy serves /api/v2 at its root).",
    );
  } else {
    throw new Error(`unexpected answer from ${target.baseUrl}: HTTP ${response.status}`);
  }
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
