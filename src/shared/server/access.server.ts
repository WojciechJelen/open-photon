import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { isPublicRequest, isPublicServerFn } from "../../app/server.ts";
import { findAccessCode, findAccessCodeById } from "./access-codes.ts";
import { accessPage, accessUrl } from "./access-page.server.ts";
import { requesterKeys, returnToken, takeToken } from "./limits.ts";

const cookieName = "photon_access";
const sessionSeconds = 12 * 60 * 60;
const sessionBodySchema = z.object({ code: z.string() });

/** Who is asking: the access code the request's session was made with. */
export type Session = { codeId: string };

function respond(body: string | null, status: number, headers?: HeadersInit) {
  const response = new Response(body, { status, headers });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );

  return response;
}

/** The code form; with `error`, the refusal of a wrong code in place of the usual intro. */
function page(next: string, error?: string, status = 200) {
  return respond(accessPage(next, error), status, { "Content-Type": "text/html; charset=utf-8" });
}

/** A JSON refusal `{ error, reason, retry_after? }`; with `retryAfter` (seconds) also its header. */
function refusal(status: number, error: string, reason: string, retryAfter?: number) {
  const response = respond(JSON.stringify({ error, reason, retry_after: retryAfter }), status, {
    "Content-Type": "application/json",
  });

  if (retryAfter !== undefined) {
    response.headers.set("Retry-After", String(retryAfter));
  }

  return response;
}

/**
 * Where `/access` returns to after the code: its `next` parameter when that is a path on this
 * site (one leading `/`, printable ASCII, no backslash), else `/`.
 */
function nextPath(url: URL) {
  const next = url.searchParams.get("next");

  return next && /^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/.test(next) ? next : "/";
}

/** A small request body (a login, a JSON action) as text, or `null` when it is over `limit` bytes. */
async function readLimitedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();

  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      size += value.byteLength;

      if (size > limit) {
        await reader.cancel();

        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * A small JSON body (at most `limit` bytes) as `schema`: `{ data }`, or `{ error }` saying why it
 * is not (too large, not JSON, not the schema), for a 400.
 */
export async function readJsonBody<T>(request: Request, schema: z.ZodType<T>, limit: number) {
  const text = await readLimitedBody(request, limit);
  const body = schema.safeParse(await new Response(text ?? "").json().catch(() => null));

  return body.success ? { data: body.data } : { error: z.prettifyError(body.error) };
}

/**
 * The code a login carries: the `/access` form's `code` field, `POST /api/session`'s `{ code }`,
 * or a link's `GET /access?code=`.
 */
async function readCode(request: Request, kind: "form" | "json" | "link") {
  if (kind === "link") {
    return new URL(request.url).searchParams.get("code");
  }

  const type = request.headers.get("Content-Type") ?? "";
  const body = await readLimitedBody(request, 4096);

  if (body === null) {
    return null;
  }

  if (kind === "form") {
    return type.startsWith("application/x-www-form-urlencoded")
      ? new URLSearchParams(body).get("code")
      : null;
  }

  if (!type.startsWith("application/json")) {
    return null;
  }

  try {
    return sessionBodySchema.safeParse(JSON.parse(body)).data?.code ?? null;
  } catch {
    return null;
  }
}

function signature(codeHash: string, codeId: string, expires: string) {
  return createHmac("sha256", codeHash).update(`photon-session:${codeId}:${expires}`).digest("hex");
}

/**
 * The session the request's cookie carries, or `null`: `<code id>.<expiry ms>.<HMAC>`, signed
 * with the code's stored hash, so it needs no server secret, survives restarts, and ends when
 * the code is revoked (or its expiry, 12 hours after the login, passes).
 */
export function readSession(request: Request, now = Date.now): Session | null {
  const token = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);

  const match = token?.match(/^([0-9a-f-]{36})\.(\d{13})\.([a-f0-9]{64})$/);
  const [, codeId, expires, mac] = match ?? [];

  if (
    !codeId ||
    !expires ||
    !mac ||
    Number(expires) <= now() ||
    Number(expires) > now() + sessionSeconds * 1000
  ) {
    return null;
  }

  const code = findAccessCodeById(codeId);

  return code &&
    timingSafeEqual(Buffer.from(mac), Buffer.from(signature(code.code_hash, codeId, expires)))
    ? { codeId }
    : null;
}

/**
 * The upload limit (`takeToken`, `UPLOAD_RATE_LIMIT` a minute per client and per code): `undefined`
 * while the request's client and code have a token (it takes one), else a 429 `rate_limited`.
 * The handlers of uploads, cuts and character photos call it first, before the body is read, so
 * it holds for every URL the router sends to them (any letter case, a trailing slash).
 */
export function uploadRefusal(request: Request, now = Date.now) {
  const wait = takeToken("upload", requesterKeys(request, readSession(request, now)), now());

  return wait === undefined
    ? undefined
    : refusal(429, `Too many uploads. Try again in ${wait} s.`, "rate_limited", wait);
}

/**
 * The server-function guard, `src/start.ts`'s global function middleware, which knows the
 * function being called (`serverFnMeta`): `undefined` for one a feature declares public
 * (`isPublicServerFn`, `src/app/server.ts`) or a request with a session, else a 401
 * `access_required`. So a new server function needs a session unless its feature declares it.
 */
export function serverFnRefusal(request: Request, meta: { filename: string; name: string }) {
  return isPublicServerFn(`${meta.filename}#${meta.name}`) || readSession(request)
    ? undefined
    : refusal(401, "Enter an access code to do this.", "access_required");
}

/**
 * The access guard, the global request middleware (`src/start.ts`). `/access` (the code form, for
 * a page opened without a session, and `GET /access?code=<code>&next=<path>`, a link that signs
 * in on opening) and `POST /api/session` (`{ code }` → 204, for the app's own inline form)
 * exchange a code for the session cookie; all three pay into the same login limits. A request
 * with a session goes on. One without a session goes on only if `isPublicRequest` lets it (an
 * allowlist: a URL it does not know, an alias of a public one included, needs the code);
 * otherwise a page asked for redirects to `/access?next=<it>` and anything else is a 401.
 */
export function createAccessGuard(
  config: {
    production: boolean;
    publicUrl?: string;
  },
  now = Date.now,
) {
  /**
   * Checks a login's code; the answer is the session cookie, or the refusal's status. Every
   * attempt takes a token from its client's bucket (`LOGIN_RATE_LIMIT` a minute, default 10) and
   * then from the instance's (`LOGIN_TOTAL_RATE_LIMIT`, default 300); a right code gives both
   * back, so only wrong codes count, and one client guessing cannot lock out anyone else.
   */
  async function login(request: Request, kind: "form" | "json" | "link") {
    const client = requesterKeys(request, null);
    const instance = ["instance"];
    const wait = takeToken("login", client, now());

    if (wait !== undefined) {
      return { status: 429 as const, retryAfter: wait };
    }

    const busy = takeToken("loginTotal", instance, now());

    if (busy !== undefined) {
      returnToken("login", client);

      return { status: 429 as const, retryAfter: busy };
    }

    const supplied = await readCode(request, kind);
    const code = supplied ? findAccessCode(supplied) : null;

    if (!code) {
      return { status: 401 as const };
    }

    returnToken("login", client);
    returnToken("loginTotal", instance);

    const expires = String(now() + sessionSeconds * 1000);

    const secure =
      config.production || new URL(config.publicUrl ?? request.url).protocol === "https:";

    return {
      codeId: code.id,
      cookie: `${cookieName}=${code.id}.${expires}.${signature(code.code_hash, code.id, expires)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionSeconds}${secure ? "; Secure" : ""}`,
      status: 200 as const,
    };
  }

  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" && ["GET", "HEAD"].includes(request.method)) {
      return respond("ok", 200);
    }

    if (url.pathname === "/access") {
      const next = nextPath(url);

      const link = request.method === "GET";

      if (link && !url.searchParams.get("code")) {
        return page(next);
      }

      if (!link && request.method !== "POST") {
        return respond("Method not allowed", 405, { Allow: "GET, POST" });
      }

      // A link that carries the code (`?code=`) signs in like the form, every lookup paying into
      // the login limit. It never signs anyone out: a visitor with a session only goes on, unless
      // the session's code has no generations left and the link's code is another, right one,
      // which then replaces it. A wrong one without a session shows the form (200), whose action
      // drops `code`, so no loop.
      const session = link ? readSession(request, now) : null;
      const result = await login(request, link ? "link" : "form");

      if (session) {
        const own = findAccessCodeById(session.codeId);

        const replace =
          result.status === 200 &&
          result.codeId !== session.codeId &&
          (!own || own.used >= own.max_generations);

        if (!replace) {
          return respond("", 303, { Location: next });
        }
      }

      if (result.status === 429) {
        return respond(`Too many attempts. Try again in ${result.retryAfter} s.`, 429, {
          "Retry-After": String(result.retryAfter),
        });
      }

      if (result.status === 401) {
        return page(next, "Incorrect access code. Please try again.", link ? 200 : 401);
      }

      return respond("", 303, { Location: next, "Set-Cookie": result.cookie });
    }

    if (url.pathname === "/api/session") {
      if (request.method !== "POST") {
        return respond("Method not allowed", 405, { Allow: "POST" });
      }

      const result = await login(request, "json");

      if (result.status === 429) {
        return refusal(
          429,
          `Too many attempts. Try again in ${result.retryAfter} s.`,
          "rate_limited",
          result.retryAfter,
        );
      }

      return result.status === 401
        ? refusal(401, "That access code is not valid.", "invalid_code")
        : respond(null, 204, { "Set-Cookie": result.cookie });
    }

    if (readSession(request, now) || isPublicRequest(request.method, url.pathname)) {
      return undefined;
    }

    // A page asked for without a session: the code first, then back to that page.
    if (request.method === "GET" && request.headers.get("Accept")?.includes("text/html")) {
      return respond("", 303, { Location: accessUrl(url.pathname + url.search) });
    }

    // An action or read that needs a session: the UI asks for the code on `access_required`.
    return refusal(401, "Enter an access code to do this.", "access_required");
  };
}

export const accessGuard = createAccessGuard({
  production: process.env.NODE_ENV === "production",
  publicUrl: process.env.PUBLIC_APP_URL,
});
