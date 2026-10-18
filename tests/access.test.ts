import assert from "node:assert/strict";
import { test } from "node:test";

import { createAccessGuard } from "../src/server/access.server.ts";

const code = "test-only-long-random-access-code";
const origin = "https://preview.example";

function login(value = code) {
  return new Request(`${origin}/access`, {
    method: "POST",
    body: new URLSearchParams({ code: value }),
  });
}

test("production fails closed without a strong code; development can stay open", async () => {
  for (const value of [undefined, "short"]) {
    const guard = createAccessGuard({ code: value, production: true });
    assert.equal((await guard(new Request(`${origin}/healthz`)))?.status, 503);
    assert.equal((await guard(new Request(`${origin}/api/jobs`, { method: "POST" })))?.status, 503);
  }

  assert.equal(await createAccessGuard({ production: false })(new Request(origin)), undefined);
});

test("anonymous APIs, server functions, media, SSE and pages are protected", async () => {
  const guard = createAccessGuard({ code, production: true });

  for (const path of [
    "/api/jobs",
    "/api/uploads",
    "/_serverFn/example",
    "/media/x.mp4",
    "/api/jobs/example/events",
    "/r/example",
  ]) {
    for (const method of ["GET", "POST", "HEAD"]) {
      assert.equal((await guard(new Request(`${origin}${path}`, { method })))?.status, 401);
    }
  }

  const page = await guard(new Request(`${origin}/studio`, { headers: { Accept: "text/html" } }));
  assert.equal(page?.status, 303);
  assert.equal(page?.headers.get("Location"), "/access");
  assert.equal((await guard(new Request(`${origin}/healthz`)))?.status, 200);
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
    new Request(`${origin}/api/jobs`, { method: "POST", headers: { Cookie: cookie } });

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
