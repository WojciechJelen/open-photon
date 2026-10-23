import { BASE_URL_ENV_VAR, COMFY_CLOUD_BASE_URL } from "@comfyorg/sdk";

const API_KEY_ENV_VAR = "COMFY_API_KEY";
const PROXY_TOKEN_ENV_VAR = "COMFY_PROXY_TOKEN";

/**
 * Where generations run. `kind` is a recipe's `target`; `apiKey` is the bearer the SDK sends
 * (a Comfy Cloud key, or a comfy-api-proxy `--token`).
 */
export type ComfyTarget =
  | { kind: "cloud"; baseUrl: string; apiKey: string }
  | { kind: "selfhost"; baseUrl: string; apiKey: string | undefined };

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, "");

/**
 * A Cloud key selects Cloud; a proxy URL without a Cloud key selects self-hosting. Proxy auth
 * uses its own token so a Cloud credential can never be sent to a different deployment.
 *
 * The SDK has no base URL option and reads `COMFY_BASE_URL` itself at `new Comfy()`. These checks
 * mirror its own (http(s), no query or fragment, every trailing slash stripped, Cloud = same
 * origin and path), so the value validated here at boot is the value the SDK later accepts.
 */
export function resolveComfyTarget(env: Record<string, string | undefined>): ComfyTarget {
  const raw = env[BASE_URL_ENV_VAR]?.trim() || COMFY_CLOUD_BASE_URL;
  const apiKey = env[API_KEY_ENV_VAR]?.trim() || undefined;
  const proxyToken = env[PROXY_TOKEN_ENV_VAR]?.trim() || undefined;
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${BASE_URL_ENV_VAR} must be an http(s) URL.`);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    /[?#]/.test(raw)
  ) {
    throw new Error(
      `${BASE_URL_ENV_VAR} must be an http(s) URL without credentials, a query or a fragment.`,
    );
  }

  const baseUrl = stripTrailingSlashes(raw);
  const cloud = new URL(COMFY_CLOUD_BASE_URL);

  if (
    url.origin !== cloud.origin ||
    stripTrailingSlashes(url.pathname) !== stripTrailingSlashes(cloud.pathname)
  ) {
    if (apiKey) {
      throw new Error(
        `${API_KEY_ENV_VAR} selects Comfy Cloud and cannot be combined with a proxy ${BASE_URL_ENV_VAR}. Unset it and use ${PROXY_TOKEN_ENV_VAR} for proxy authentication.`,
      );
    }

    return { apiKey: proxyToken, baseUrl, kind: "selfhost" };
  }

  if (proxyToken) {
    throw new Error(
      `${PROXY_TOKEN_ENV_VAR} requires a self-hosted ${BASE_URL_ENV_VAR}; it cannot be used with Comfy Cloud.`,
    );
  }

  if (!apiKey) {
    throw new Error(
      `Set ${API_KEY_ENV_VAR} for Comfy Cloud, or ${BASE_URL_ENV_VAR} and ${PROXY_TOKEN_ENV_VAR} for a self-hosted comfy-api-proxy.`,
    );
  }

  return { apiKey, baseUrl, kind: "cloud" };
}

/** One line for logs: the target and whether a bearer is sent, never the key. */
export function describeComfyTarget({ apiKey, baseUrl, kind }: ComfyTarget) {
  return `comfy target=${kind} base=${baseUrl} auth=${apiKey ? "bearer" : "none"}`;
}

let target: ComfyTarget | undefined;

/** `resolveComfyTarget(process.env)`, resolved on first use and then fixed for the process. */
export function comfyTarget() {
  target ??= resolveComfyTarget(process.env);

  return target;
}

/**
 * The non-secret identity of the endpoint a generation runs on, as `generations.target` and
 * `target_origin` record it: Cloud (`origin` null: there is one), or a self-hosted proxy by the
 * origin of its `COMFY_BASE_URL` (scheme, host and port; never a key or token). Only the endpoint
 * a job was submitted to knows it, so a server whose target changed must not ask another one.
 */
export type ProviderTarget = { kind: ComfyTarget["kind"]; origin: string | null };

/** This server's `ProviderTarget`, from `comfyTarget()`. */
export function providerTarget(): ProviderTarget {
  const { baseUrl, kind } = comfyTarget();

  return { kind, origin: kind === "selfhost" ? new URL(baseUrl).origin : null };
}
