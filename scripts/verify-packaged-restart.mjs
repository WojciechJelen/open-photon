import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { accessCookie } from "./access-session.mjs";

// Kills the packaged app (`docker kill --signal KILL`) with generations in every state a restart
// must settle, starts it again and checks what `recoverAfterRestart` and the dispatcher made of
// them (`docs/parallel-feature-foundation.md`, "Admission, queue and restart recovery"):
//
// - queued (the stub runs the job until the app is down): followed to done, never sent again;
// - finalizing (Comfy finished, the first download failed): completed, its attempt count kept;
// - preparing after the submit started (the stub never answers it): `unknown`, never sent again;
// - preparing before any submit (a claim set by SQL while the app is down, as `claimNextWaiting`
//   leaves one: the window is too short to kill in): back in line, sent under its key, done;
// - waiting: sent after it, done.
//
// No event stream is opened: the dispatcher alone moves them. The production image refuses the
// fake provider, so Comfy is `scripts/stub-comfy-api.mjs` in a container of the same image.
// Needs Docker and the image (`RESTART_IMAGE`, default `open-photon:ci`); it creates and removes
// its own containers, network and volume (`RESTART_PREFIX`) and publishes the app on
// `RESTART_APP_PORT` (default 3034) and the stub on `RESTART_STUB_PORT` (default 3035).

const image = process.env.RESTART_IMAGE ?? "open-photon:ci";
const prefix = process.env.RESTART_PREFIX ?? "open-photon-restart";
const appPort = Number(process.env.RESTART_APP_PORT ?? 3034);
const stubPort = Number(process.env.RESTART_STUB_PORT ?? 3035);
const app = `${prefix}-app`;
const stub = `${prefix}-comfy`;
const base = `http://127.0.0.1:${appPort}`;
const stubBase = `http://127.0.0.1:${stubPort}`;
const final = ["done", "failed", "unknown", "cancelled"];

function docker(...args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });

  assert.equal(result.status, 0, `docker ${args[0]}: ${result.stderr}`);

  return result.stdout.trim();
}

function removeAll() {
  for (const args of [
    ["rm", "--force", app, stub],
    ["network", "rm", prefix],
    ["volume", "rm", prefix],
  ]) {
    spawnSync("docker", args, { encoding: "utf8" });
  }
}

/** Runs `query` with `params` on the app's database, from a container of its own. */
function sql(query, params = []) {
  const script = `
    import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync("/app/data/app.sqlite");
    db.exec("PRAGMA busy_timeout = 5000");
    console.log(JSON.stringify(db.prepare(process.env.SQL).all(...JSON.parse(process.env.PARAMS))));
  `;

  return JSON.parse(
    docker(
      "run",
      "--rm",
      "--volume",
      `${prefix}:/app/data`,
      "--env",
      `SQL=${query}`,
      "--env",
      `PARAMS=${JSON.stringify(params)}`,
      "--entrypoint",
      "node",
      image,
      "--input-type=module",
      "--no-warnings",
      "-e",
      script,
    ),
  );
}

const row = (id) =>
  sql(
    `SELECT id, status, error_code, idempotency_key, submit_started_at, claimed_by,
            finalize_attempts, access_code_id FROM generations WHERE id = ?`,
    [id],
  )[0];

async function until(ready, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await ready();

    if (value) {
      return value;
    }

    assert.ok(Date.now() < deadline, `Timed out waiting for ${what}`);
    await delay(500);
  }
}

async function healthy() {
  await until(async () => {
    try {
      return (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
      return false;
    }
  }, "the app to answer /healthz");
}

async function stubState(change) {
  const response = await fetch(`${stubBase}/stub/state`, {
    body: change && JSON.stringify(change),
    method: change ? "POST" : "GET",
  });

  assert.equal(response.status, 200);

  return response.json();
}

/** The last `generation.recovered` line the app logged. */
function recovered() {
  const line = docker("logs", app)
    .split("\n")
    .filter((text) => text.includes('"generation.recovered"'))
    .at(-1);

  assert.ok(line, "The app logs what it recovered at boot");

  const { cancelled, released, unknown } = JSON.parse(line);

  return { cancelled, released, unknown };
}

let cookie = "";

function generate(caption) {
  return fetch(`${base}/api/character-generations`, {
    body: JSON.stringify({ caption, seed: 7 }),
    headers: { "Content-Type": "application/json", Cookie: cookie },
    method: "POST",
  });
}

const submitsOf = (state, text) => state.submits.filter(({ graph }) => graph.includes(text));

removeAll();

try {
  docker("network", "create", prefix);
  docker("volume", "create", prefix);
  docker(
    "run",
    "--detach",
    "--name",
    stub,
    "--network",
    prefix,
    "--network-alias",
    "comfy",
    "--publish",
    `127.0.0.1:${stubPort}:8188`,
    "--volume",
    `${resolve("scripts/stub-comfy-api.mjs")}:/stub/server.mjs:ro`,
    "--volume",
    `${resolve("tests/fixtures/fake-output.png")}:/stub/output.png:ro`,
    "--entrypoint",
    "node",
    image,
    "/stub/server.mjs",
  );
  docker(
    "run",
    "--detach",
    "--init",
    "--name",
    app,
    "--network",
    prefix,
    "--publish",
    `127.0.0.1:${appPort}:3000`,
    "--volume",
    `${prefix}:/app/data`,
    "--env",
    "COMFY_BASE_URL=http://comfy:8188",
    "--env",
    "IN_FLIGHT_MAX=3",
    "--env",
    "GENERATION_DISPATCH_MS=200",
    "--env",
    "GENERATE_RATE_LIMIT=20",
    image,
  );

  await healthy();
  await until(
    () =>
      stubState()
        .then(() => true)
        .catch(() => false),
    "the stub to answer",
  );

  process.env.ACCESS_CODE = docker("exec", app, "node", "scripts/mint-code.mjs", "restart", "10");
  cookie = await accessCookie(base);

  await stubState({ failDownloads: true });

  // 1. Queued: admitted at once and submitted; the stub keeps the job running.
  const holding = await generate("Restart check: [stub:hold] was queued");

  assert.equal(holding.status, 201);

  const queuedId = (await holding.json()).id;

  // 2. Finalizing: admitted and submitted; Comfy finishes it, its first download fails.
  const finishing = await generate("Restart check: was finalizing");

  assert.equal(finishing.status, 201);

  const finishingId = (await finishing.json()).id;

  const finalizing = await until(() => {
    const current = row(finishingId);

    return current.status === "finalizing" && current.finalize_attempts === 1 && current;
  }, "a failed first download");

  // 3. Preparing after the submit started: the stub takes the graph and never answers. The
  // request is left hanging; killing the app ends it. (The SDK gives up after 30 s, so the kill
  // below comes well before.)
  void generate("Restart check: [stub:hang] was submitting").catch(() => {});

  const submitting = await until(
    () =>
      sql(
        "SELECT id FROM generations WHERE status = 'preparing' AND submit_started_at IS NOT NULL",
      )[0],
    "a submit in flight",
    15_000,
  );

  // 4. Waiting: every place is taken (queued, finalizing, preparing), so these wait in line.
  const waiting = [];

  for (const [index, caption] of [
    "Restart check: was claimed, nothing sent",
    "Restart check: was waiting",
  ].entries()) {
    const response = await generate(caption);
    const receipt = await response.json();

    assert.equal(response.status, 202);
    assert.deepEqual([receipt.status, receipt.position], ["waiting", index + 1]);
    waiting.push({ caption, id: receipt.id });
  }

  const [claimed, inLine] = waiting;
  const before = await stubState();

  assert.equal(submitsOf(before, "[stub:hang]").length, 1);

  docker("kill", "--signal", "KILL", app);

  // The oldest waiting row as a claim the stopped process never sent.
  const { claimed_by: claimant } = row(submitting.id);

  sql(
    `UPDATE generations SET status = 'preparing', claimed_at = ?, claimed_by = ?
     WHERE id = ? AND status = 'waiting' RETURNING id`,
    [new Date().toISOString(), claimant ?? "stopped-process", claimed.id],
  );

  const ids = [queuedId, finishingId, submitting.id, claimed.id, inLine.id];
  const stopped = Object.fromEntries(ids.map((id) => [id, row(id)]));

  assert.deepEqual(
    Object.values(stopped).map(({ status, submit_started_at }) => [
      status,
      submit_started_at !== null,
    ]),
    [
      ["queued", true],
      ["finalizing", true],
      ["preparing", true],
      ["preparing", false],
      ["waiting", false],
    ],
  );

  const used = () =>
    sql("SELECT used FROM access_codes WHERE id = ?", [finalizing.access_code_id])[0].used;

  const usedBefore = used();

  await stubState({ failDownloads: false, hold: false });
  docker("start", app);
  await healthy();

  assert.deepEqual(recovered(), {
    cancelled: [],
    released: [claimed.id],
    unknown: [submitting.id],
  });

  const settled = await until(
    () => {
      const rows = ids.map(row);

      return rows.every(({ status }) => final.includes(status)) && rows;
    },
    "every generation to settle",
    120_000,
  );

  assert.deepEqual(
    settled.map(({ status }) => status),
    ["done", "done", "unknown", "done", "done"],
  );
  assert.equal(settled[1].finalize_attempts, 1);

  // After the restart: the claimed one under the key it had, then the waiting one; nothing else,
  // the queued one included.
  const after = (await stubState()).submits.slice(before.submits.length);

  assert.deepEqual(
    after.map(({ graph, key }) => [
      key,
      [claimed, inLine].find(({ caption }) => graph.includes(caption))?.caption,
    ]),
    [
      [stopped[claimed.id].idempotency_key, claimed.caption],
      [stopped[inLine.id].idempotency_key, inLine.caption],
    ],
  );

  // The unknown one keeps its count; nothing was refunded or charged again.
  assert.equal(used(), usedBefore);

  // A clean restart finds nothing to settle and sends nothing.
  docker("restart", app);
  await healthy();
  await delay(2000);

  assert.deepEqual(recovered(), { cancelled: [], released: [], unknown: [] });
  assert.equal((await stubState()).submits.length, before.submits.length + 2);
  assert.equal(row(submitting.id).status, "unknown");

  console.info(
    JSON.stringify({
      after: Object.fromEntries(ids.map((id, index) => [id, settled[index].status])),
      before: Object.fromEntries(ids.map((id) => [id, stopped[id].status])),
      event: "packaged-restart.verified",
      submitsAfterRestart: after.length,
      used: usedBefore,
    }),
  );
} finally {
  if (process.env.RESTART_KEEP !== "1") {
    removeAll();
  }
}
