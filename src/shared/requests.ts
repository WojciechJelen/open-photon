import { z } from "zod";

/** An API response body: its JSON, or `null` when it has none or it is not JSON. */
export const bodySchema = z.json().nullable().catch(null);

type Body = z.infer<typeof bodySchema>;

const errorBodySchema = z.object({ error: z.string(), reason: z.string().optional() });

/** A refused request in words, with the API's `reason` code when it gave one. */
export type Refusal = { message: string; reason?: string };

/**
 * The refusal an API error response carries: `{ error, reason? }`, or a status-based fallback. A
 * 401 without a body of its own is `access_required`, which makes the UI ask for the code.
 */
export function refusal(status: number, body: Body): Refusal {
  if (status === 413) {
    return { message: "This file is over 128 MiB.", reason: "too_large" };
  }

  const parsed = errorBodySchema.safeParse(body);

  if (parsed.success) {
    return { message: parsed.data.error, reason: parsed.data.reason };
  }

  return status === 401
    ? { message: "Enter an access code to do this.", reason: "access_required" }
    : { message: `The request failed (${status}). Try again.` };
}

const writeListeners = new Set<() => void>();

/**
 * Runs `listener` after every write `callApi` makes that the server accepts (any method but
 * `GET`, answered 2xx): a new render, retry or rerun spends the access code's generations, so the
 * header reads what is left again. The answer is the unsubscribe.
 */
export function onApiWrite(listener: () => void) {
  writeListeners.add(listener);

  return () => {
    writeListeners.delete(listener);
  };
}

/**
 * A `fetch` to the app's API: the JSON body of a 2xx answer parsed with `schema`, or the refusal
 * of any other answer (or of no answer at all). An accepted write tells `onApiWrite`'s listeners.
 */
export async function callApi<T extends z.ZodType>(
  schema: T,
  url: string,
  init: RequestInit,
): Promise<{ data: z.output<T> } | { refusal: Refusal }> {
  const response = await fetch(url, init).catch(() => null);

  if (!response) {
    return { refusal: { message: "The request did not reach the server. Check the connection." } };
  }

  const body = bodySchema.parse(await response.json().catch(() => null));

  if (!response.ok) {
    return { refusal: refusal(response.status, body) };
  }

  if ((init.method ?? "GET").toUpperCase() !== "GET") {
    for (const listener of writeListeners) {
      listener();
    }
  }

  return { data: schema.parse(body) };
}
