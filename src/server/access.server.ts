import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { accessPage } from "./access-page.server.ts";

const cookieName = "photon_access";
const sessionSeconds = 12 * 60 * 60;
const bodyLimit = 4096;

function hash(value: string) {
  return createHash("sha256").update(value).digest();
}

function respond(body: string, status: number, headers?: HeadersInit) {
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

function page(message?: string, status = 200) {
  return respond(accessPage(message), status, { "Content-Type": "text/html; charset=utf-8" });
}

async function readCode(request: Request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) {
    return null;
  }

  const reader = request.body?.getReader();

  if (!reader) {
    return null;
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

      if (size > bodyLimit) {
        await reader.cancel();

        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("code");
}

export function createAccessGuard(
  config: { code?: string; production: boolean; publicUrl?: string },
  now = Date.now,
) {
  const code = config.code;
  const configured = Boolean(code && code.length >= 24 && code.length <= 256);
  const enabled = config.production || code !== undefined;
  const key = hash(code ?? "");
  let attempts = 0;
  let resetAt = 0;

  function signature(expires: string) {
    return createHmac("sha256", key).update(`photon-session:${expires}`).digest("hex");
  }

  function authenticated(request: Request) {
    const token = request.headers
      .get("Cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);

    const match = token?.match(/^(\d{13})\.([a-f0-9]{64})$/);

    if (
      !match ||
      !match[1] ||
      !match[2] ||
      Number(match[1]) <= now() ||
      Number(match[1]) > now() + sessionSeconds * 1000
    ) {
      return false;
    }

    return timingSafeEqual(Buffer.from(match[2]), Buffer.from(signature(match[1])));
  }

  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" && ["GET", "HEAD"].includes(request.method)) {
      return respond(
        configured || !enabled ? "ok" : "Access is not configured",
        configured || !enabled ? 200 : 503,
      );
    }

    if (!enabled) {
      return undefined;
    }

    if (!configured) {
      return respond("Private preview is not configured", 503);
    }

    if (url.pathname === "/access") {
      if (request.method === "GET") {
        return page();
      }

      if (request.method !== "POST") {
        return respond("Method not allowed", 405, { Allow: "GET, POST" });
      }

      if (now() >= resetAt) {
        resetAt = now() + 60_000;
        attempts = 0;
      }

      if (++attempts > 10) {
        return respond("Too many attempts. Try again in a minute.", 429, { "Retry-After": "60" });
      }

      const supplied = await readCode(request);

      if (supplied === null || !timingSafeEqual(hash(supplied), key)) {
        return page("Incorrect access code. Please try again.", 401);
      }

      const expires = String(now() + sessionSeconds * 1000);
      const secure = new URL(config.publicUrl ?? request.url).protocol === "https:";

      return respond("", 303, {
        Location: "/",
        "Set-Cookie": `${cookieName}=${expires}.${signature(expires)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionSeconds}${secure ? "; Secure" : ""}`,
      });
    }

    if (authenticated(request)) {
      return undefined;
    }

    if (request.method === "GET" && request.headers.get("Accept")?.includes("text/html")) {
      return respond("", 303, { Location: "/access" });
    }

    return respond("Access code required", 401);
  };
}

export const accessGuard = createAccessGuard({
  code: process.env.APP_ACCESS_CODE,
  production: process.env.NODE_ENV === "production",
  publicUrl: process.env.PUBLIC_APP_URL,
});
