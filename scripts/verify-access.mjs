import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { accessCookie } from "./access-session.mjs";

const base = process.env.BASE_URL;

assert.ok(base, "Set BASE_URL to the guarded deployment");

assert.ok(process.env.APP_ACCESS_CODE, "Set APP_ACCESS_CODE for authenticated checks");

for (let attempt = 0; ; attempt++) {
  try {
    assert.equal(
      (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5000) })).status,
      200,
    );
    break;
  } catch (error) {
    if (attempt >= 60) {
      throw error;
    }

    await delay(500);
  }
}

for (const [path, method] of [
  ["/api/jobs", "POST"],
  ["/api/uploads", "POST"],
  ["/_serverFn/anonymous-probe", "POST"],
  ["/api/jobs/anonymous-probe/events", "GET"],
  ["/media/x.mp4", "GET"],
  ["/r/test", "GET"],
]) {
  const response = await fetch(`${base}${path}`, { method, redirect: "manual" });
  assert.equal(response.status, 401, `Anonymous ${method} ${path} must be blocked`);
}

const page = await fetch(`${base}/studio`, {
  headers: { Accept: "text/html" },
  redirect: "manual",
});

assert.equal(page.status, 303);

assert.equal(page.headers.get("Location"), "/access");

const Cookie = await accessCookie(base);
const allowed = await fetch(`${base}/studio`, { headers: { Cookie } });

assert.equal(allowed.status, 200);

assert.match(allowed.headers.get("Cache-Control"), /private, no-store/);

assert.ok((await allowed.text()).includes("Render on Comfy"));

const invalid = await fetch(`${base}/api/jobs`, {
  method: "POST",
  headers: { Cookie, "Content-Type": "application/json" },
  body: "{}",
});

assert.equal(
  invalid.status,
  400,
  "Authenticated invalid input reaches validation without submitting a job",
);

const crossSite = await fetch(`${base}/api/jobs`, {
  method: "POST",
  headers: { Cookie, Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
  body: "{}",
});

assert.equal(crossSite.status, 403, "Cross-site requests must be rejected even with a cookie");

const video = await fetch(`${base}/media/x.mp4`, { headers: { Cookie, Range: "bytes=0-99" } });

assert.equal(video.status, 206);

assert.equal((await video.arrayBuffer()).byteLength, 100);

console.log(
  "Access verification passed: anonymous requests blocked, login, CSRF, validation and private video ranges work. No paid jobs submitted.",
);
