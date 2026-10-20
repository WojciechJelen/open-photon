import { createHash } from "node:crypto";

import { z } from "zod";

import type { Session } from "./access.server.ts";

/**
 * What a token pays for: `upload` an upload, a cut or a character photo; `generate` a request to
 * `POST /api/generate`, `…/retry` or `…/rerun` that is not answered with an existing result.
 */
type Action = "generate" | "upload";

/** Each action's limit per minute, and the variable that changes it. */
const limits: Record<Action, { fallback: number; name: string }> = {
  generate: { fallback: 3, name: "GENERATE_RATE_LIMIT" },
  upload: { fallback: 10, name: "UPLOAD_RATE_LIMIT" },
};

// A bucket refills in a minute; one left alone that long is full, the same as none.
const REFILL_MS = 60_000;
const MAX_BUCKETS = 10_000;

// The Node server (srvx) adds the connection's address to the request as `ip`.
const connectionSchema = z.object({ ip: z.string() });

/** The whole number ≥ `min` the variable `name` sets, `fallback` when it is unset. */
function setting(name: string, fallback: number, min: number) {
  const value = process.env[name];

  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be a whole number of at least ${min}, not "${value}"`);
  }

  return parsed;
}

/**
 * The most generations in flight at once (`IN_FLIGHT_MAX`, default 1: Comfy Cloud Standard runs
 * one workflow at a time); 0 refuses every new one.
 */
export function inFlightMax() {
  return setting("IN_FLIGHT_MAX", 1, 0);
}

/**
 * The buckets a request pays from: its client's, and its access code's when it has a session. The
 * client is the address in the `CLIENT_IP_HEADER` header (one the proxy in front of the app sets
 * itself, such as Railway's `X-Real-IP`) or, when that is unset, the connection's own address;
 * forwarded headers are ignored then, since any client can send them. Only a hash of it is kept.
 */
export function requesterKeys(request: Request, session: Session | null) {
  const header = process.env.CLIENT_IP_HEADER;

  const address = header
    ? request.headers.get(header)?.trim()
    : connectionSchema.safeParse(request).data?.ip;

  const client = createHash("sha256")
    .update(address ?? "")
    .digest("hex");

  return session ? [`client:${client}`, `code:${session.codeId}`] : [`client:${client}`];
}

// Least recently used first: a bucket is moved to the end each time it pays.
const buckets = new Map<string, { at: number; tokens: number }>();

/**
 * Token buckets in memory (one process, so that is all of them), one per action and key. Each
 * holds the action's limit and refills at that many a minute. A request pays one token from each
 * of `keys` when all of them have one, and gets `undefined`; otherwise it pays nothing and gets
 * the seconds until they do. At most 10,000 buckets are kept: idle (full) ones are dropped first,
 * then the least recently used.
 */
export function takeToken(action: Action, keys: string[], now: number) {
  const { fallback, name } = limits[action];
  const limit = setting(name, fallback, 1);

  for (const [key, bucket] of buckets) {
    if (now - bucket.at < REFILL_MS && buckets.size <= MAX_BUCKETS) {
      break;
    }

    buckets.delete(key);
  }

  const held = keys.map((key) => {
    const bucket = buckets.get(`${action}:${key}`);

    return {
      key: `${action}:${key}`,
      tokens: bucket
        ? Math.min(limit, bucket.tokens + (Math.max(0, now - bucket.at) * limit) / REFILL_MS)
        : limit,
    };
  });

  const missing = Math.max(...held.map(({ tokens }) => 1 - tokens));

  if (missing > 0) {
    return Math.ceil((missing * REFILL_MS) / limit / 1000);
  }

  for (const { key, tokens } of held) {
    buckets.delete(key);
    buckets.set(key, { at: now, tokens: tokens - 1 });
  }

  return undefined;
}

/**
 * Gives back the token `takeToken` took from each of `keys` for `action`, for a request that
 * turned out to be free after all (it got an existing result).
 */
export function returnToken(action: Action, keys: string[]) {
  const limit = setting(limits[action].name, limits[action].fallback, 1);

  for (const key of keys) {
    const bucket = buckets.get(`${action}:${key}`);

    if (bucket) {
      bucket.tokens = Math.min(limit, bucket.tokens + 1);
    }
  }
}
