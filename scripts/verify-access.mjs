import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { accessCookie } from "./access-session.mjs";

const base = process.env.BASE_URL;

assert.ok(base, "Set BASE_URL to the deployment");

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
  [`/api/generations/${probe}`, "GET"],
  [`/api/generations/${probe}/events`, "GET"],
  [`/api/generations/${probe}/retry`, "POST"],
  [`/media/${probe}.mp4`, "GET"],
]) {
  const response = await fetch(`${base}${path}`, { method, redirect: "manual" });
  assert.equal(response.status, 401, `Anonymous ${method} ${path} must be blocked`);
}

// The picker is open without a code; a generation's page asks for it first.
const picker = await fetch(`${base}/`, { headers: { Accept: "text/html" }, redirect: "manual" });

assert.equal(picker.status, 200);

assert.ok((await picker.text()).includes("Open Photon"));

const page = await fetch(`${base}/g/${probe}`, {
  headers: { Accept: "text/html" },
  redirect: "manual",
});

assert.equal(page.status, 303);

assert.equal(page.headers.get("Location"), `/access?next=${encodeURIComponent(`/g/${probe}`)}`);

const anonymousGenerate = await fetch(`${base}/api/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ character_id: probe, motion_asset_id: probe }),
});

assert.equal(anonymousGenerate.status, 404, "An unknown motion is refused before anything else");

const Cookie = await accessCookie(base);

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

assert.equal(
  (await fetch(`${base}/media/${id}.mp4`)).status,
  401,
  "An upload stays private without a session",
);

console.log(
  "Access verification passed: the picker is open, actions and private media need a session, login, CSRF, validation and private video ranges work. No paid jobs submitted.",
);
