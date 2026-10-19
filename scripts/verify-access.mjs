import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const probe = "00000000-0000-4000-8000-000000000000";

for (const [path, method] of [
  ["/api/uploads", "POST"],
  ["/api/assets/anonymous-probe/trim", "POST"],
  ["/api/characters", "POST"],
  ["/_serverFn/anonymous-probe", "POST"],
  [`/api/generations/${probe}`, "GET"],
  [`/api/generations/${probe}/events`, "GET"],
  [`/api/generations/${probe}/retry`, "POST"],
  [`/media/${probe}.mp4`, "GET"],
]) {
  const response = await fetch(`${base}${path}`, { method, redirect: "manual" });
  assert.equal(response.status, 401, `Anonymous ${method} ${path} must be blocked`);
}

const page = await fetch(`${base}/`, {
  headers: { Accept: "text/html" },
  redirect: "manual",
});

assert.equal(page.status, 303);

assert.equal(page.headers.get("Location"), "/access");

const Cookie = await accessCookie(base);
const allowed = await fetch(`${base}/`, { headers: { Cookie } });

assert.equal(allowed.status, 200);

assert.match(allowed.headers.get("Cache-Control"), /private, no-store/);

assert.ok((await allowed.text()).includes("Open Photon"));

const invalid = await fetch(`${base}/api/generations/not-a-uuid`, { headers: { Cookie } });

assert.equal(invalid.status, 400, "Authenticated invalid input reaches validation");

const crossSite = await fetch(`${base}/api/uploads`, {
  method: "POST",
  headers: { Cookie, Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
});

assert.equal(crossSite.status, 403, "Cross-site requests must be rejected even with a cookie");

const form = new FormData();

form.append("file", new Blob([await readFile("fixtures/x.mp4")]), "x.mp4");

const upload = await fetch(`${base}/api/uploads`, {
  method: "POST",
  headers: { Cookie },
  body: form,
});

assert.ok([200, 201].includes(upload.status), `Upload returned ${upload.status}`);

const { id } = await upload.json();
const video = await fetch(`${base}/media/${id}.mp4`, { headers: { Cookie, Range: "bytes=0-99" } });

assert.equal(video.status, 206);

assert.equal((await video.arrayBuffer()).byteLength, 100);

console.log(
  "Access verification passed: anonymous requests blocked, login, CSRF, validation and private video ranges work. No paid jobs submitted.",
);
