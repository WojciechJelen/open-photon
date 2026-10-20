import assert from "node:assert/strict";
import { test } from "node:test";

import { createAccessGuard } from "../src/server/access.server.ts";

const code = "test-only-long-random-access-code";
const origin = "https://preview.example";

function login(value = code, path = "/access") {
  return new Request(`${origin}${path}`, {
    method: "POST",
    body: new URLSearchParams({ code: value }),
  });
}

test("production fails closed without a strong code; development can stay open", async () => {
  for (const value of [undefined, "short"]) {
    const guard = createAccessGuard({ code: value, production: true });
    assert.equal((await guard(new Request(`${origin}/healthz`)))?.status, 503);
    assert.equal(
      (await guard(new Request(`${origin}/api/uploads`, { method: "POST" })))?.status,
      503,
    );
  }

  assert.equal(await createAccessGuard({ production: false })(new Request(origin)), undefined);
});

test("anonymous APIs, server functions, media, SSE and pages are protected", async () => {
  const guard = createAccessGuard({ code, production: true });

  for (const path of [
    "/api/uploads",
    "/_serverFn/example",
    "/media/example.mp4",
    "/api/generations/example",
    "/api/generations/example/events",
    "/api/generations/example/retry",
  ]) {
    for (const method of ["GET", "POST", "HEAD"]) {
      assert.equal((await guard(new Request(`${origin}${path}`, { method })))?.status, 401);
    }
  }

  const page = await guard(new Request(`${origin}/`, { headers: { Accept: "text/html" } }));
  assert.equal(page?.status, 303);
  assert.equal(page?.headers.get("Location"), "/access");
  assert.equal((await guard(new Request(`${origin}/healthz`)))?.status, 200);
});

test("a page asked for without a session opens after the code; any other target opens /", async () => {
  const guard = createAccessGuard({ code, production: true });

  const redirect = await guard(
    new Request(`${origin}/g/example?x=1`, { headers: { Accept: "text/html" } }),
  );

  const access = redirect?.headers.get("Location") ?? "";
  assert.equal(access, "/access?next=%2Fg%2Fexample%3Fx%3D1");
  assert.ok((await (await guard(new Request(`${origin}${access}`)))?.text())?.includes(access));
  assert.equal((await guard(login(code, access)))?.headers.get("Location"), "/g/example?x=1");

  for (const next of ["//evil.example/", "/\\evil.example", "https://evil.example/", "x"]) {
    const path = `/access?next=${encodeURIComponent(next)}`;
    assert.equal((await guard(login(code, path)))?.headers.get("Location"), "/");
  }
});

test("signed sessions survive a restart but reject tampering, expiry and code rotation", async () => {
  let time = Date.now();
  const guard = createAccessGuard({ code, production: true }, () => time);
  const response = await guard(login());
  assert.equal(response?.status, 303);
  const header = response?.headers.get("Set-Cookie") ?? "";

  for (const flag of ["HttpOnly", "SameSite=Strict", "Secure", "Max-Age=43200"]) {
    assert.ok(header.includes(flag));
  }

  assert.ok(!header.includes(code));
  const cookie = header.split(";")[0] ?? "";

  const request = () =>
    new Request(`${origin}/api/uploads`, { method: "POST", headers: { Cookie: cookie } });

  assert.equal(await guard(request()), undefined);
  assert.equal(await createAccessGuard({ code, production: true })(request()), undefined);
  assert.equal(
    (await createAccessGuard({ code: `${code}-rotated`, production: true })(request()))?.status,
    401,
  );
  assert.equal(
    (await guard(new Request(origin, { headers: { Cookie: `${cookie}a` } })))?.status,
    401,
  );
  time += 12 * 60 * 60 * 1000;
  assert.equal((await guard(request()))?.status, 401);
});

test("login rejects oversized bodies and throttles attempts without trusting client IP headers", async () => {
  let time = Date.now();
  const guard = createAccessGuard({ code, production: true }, () => time);
  assert.equal((await guard(login("x".repeat(5000))))?.status, 401);

  for (let attempt = 0; attempt < 9; attempt++) {
    assert.equal((await guard(login("wrong")))?.status, 401);
  }

  assert.equal((await guard(login()))?.status, 429);
  time += 60_000;
  assert.equal((await guard(login()))?.status, 303);
});

test("a public path (a share page and its media) opens without a session, for GET and HEAD only", async () => {
  const guard = createAccessGuard({
    code,
    isPublic: (pathname) => pathname === "/r/shared" || pathname === "/media/shared.mp4",
    production: true,
  });

  for (const path of ["/r/shared", "/media/shared.mp4"]) {
    for (const method of ["GET", "HEAD"]) {
      assert.equal(await guard(new Request(`${origin}${path}`, { method })), undefined);
    }

    assert.equal((await guard(new Request(`${origin}${path}`, { method: "POST" })))?.status, 401);
  }

  assert.equal((await guard(new Request(`${origin}/media/private.mp4`)))?.status, 401);

  const page = await guard(
    new Request(`${origin}/g/example`, { headers: { Accept: "text/html" } }),
  );

  assert.equal(page?.status, 303);
});
