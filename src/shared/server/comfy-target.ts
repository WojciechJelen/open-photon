import { BASE_URL_ENV_VAR, COMFY_CLOUD_BASE_URL } from "@comfyorg/sdk";

const API_KEY_ENV_VAR = "COMFY_API_KEY";

/**
 * Where generations run. `kind` is a recipe's `target`; `apiKey` is the bearer the SDK sends
 * (a Comfy Cloud key, or a comfy-api-proxy `--token`).
 */
export type ComfyTarget =
  | { kind: "cloud"; baseUrl: string; apiKey: string }
  | { kind: "selfhost"; baseUrl: string; apiKey: string | undefined };

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, "");

/**
 * The target `COMFY_BASE_URL` and `COMFY_API_KEY` name: Comfy Cloud when the URL is blank or Comfy
 * Cloud's, any other deployment (a comfy-api-proxy) otherwise. Pure; throws an Error with an
 * operator-readable message on invalid config, and never puts the key in it.
 *
 * The SDK has no base URL option and reads `COMFY_BASE_URL` itself at `new Comfy()`. These checks
 * mirror its own (http(s), no query or fragment, every trailing slash stripped, Cloud = same
 * origin and path), so the value validated here at boot is the value the SDK later accepts.
 */
export function resolveComfyTarget(env: Record<string, string | undefined>): ComfyTarget {
  const raw = env[BASE_URL_ENV_VAR]?.trim() || COMFY_CLOUD_BASE_URL;
  const apiKey = env[API_KEY_ENV_VAR]?.trim() || undefined;
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${BASE_URL_ENV_VAR} is not a URL: ${JSON.stringify(raw)}`);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.search !== "" ||
    url.hash !== "" ||
    /[?#]/.test(raw)
  ) {
    throw new Error(
      `${BASE_URL_ENV_VAR} must be an http(s) URL with no query or fragment, such as https://<host>:8189, not ${JSON.stringify(raw)}`,
    );
  }

  const baseUrl = stripTrailingSlashes(raw);
  const cloud = new URL(COMFY_CLOUD_BASE_URL);

  if (
    url.origin !== cloud.origin ||
    stripTrailingSlashes(url.pathname) !== stripTrailingSlashes(cloud.pathname)
  ) {
    return { apiKey, baseUrl, kind: "selfhost" };
  }

  if (!apiKey) {
    throw new Error(
      `${API_KEY_ENV_VAR} is not set. Comfy Cloud (${COMFY_CLOUD_BASE_URL}, used while ${BASE_URL_ENV_VAR} is unset) requires an API key; set ${BASE_URL_ENV_VAR} to a self-hosted comfy-api-proxy to use a deployment that does not.`,
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
