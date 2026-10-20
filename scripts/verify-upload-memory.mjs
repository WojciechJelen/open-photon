import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, open, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { accessCookie } from "./access-session.mjs";

let cookie = "";

const context = process.env.MEMORY_DOCKER_CONTEXT ?? "colima";
const container = process.env.MEMORY_CONTAINER;
const base = process.env.BASE_URL;
const output = process.env.MEMORY_REPORT ?? "work/upload-memory.json";
const fixture = "work/memory-upload-100MiB.mp4";
const limit = 64 * 1024 * 1024;

assert.ok(container, "Set MEMORY_CONTAINER to a dedicated test container; it will be restarted");

assert.ok(base, "Set BASE_URL to the dedicated test container's HTTP address");

function docker(...args) {
  const result = spawnSync("docker", ["--context", context, ...args], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);

  return result.stdout.trim();
}

function snapshot() {
  const raw = docker(
    "exec",
    container,
    "sh",
    "-c",
    String.raw`cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.stat; for p in /proc/[0-9]*/status; do if process_status=$(sed -n "/^Name:/p;/^Pid:/p;/^PPid:/p;/^VmRSS:/p;/^RssAnon:/p" "$p" 2>/dev/null); then printf "PROCESS\n%s\n" "$process_status"; elif [ -e "$p" ]; then exit 1; fi; done`,
  );

  const [memory, ...processes] = raw.split("PROCESS\n");
  const lines = memory.trim().split("\n");
  const current = Number(lines.shift());

  const stats = Object.fromEntries(
    lines.map((line) => {
      const [key, value] = line.trim().split(/\s+/);

      return [key, Number(value)];
    }),
  );

  return {
    activeFile: stats.active_file,
    anon: stats.anon,
    current,
    file: stats.file,
    inactiveFile: stats.inactive_file,
    processes: processes.map((text) => {
      const fields = Object.fromEntries(
        text
          .trim()
          .split("\n")
          .map((line) => {
            const colon = line.indexOf(":");

            return [line.slice(0, colon), line.slice(colon + 1).trim()];
          }),
      );

      return {
        anon: Number.parseInt(fields.RssAnon ?? "0", 10) * 1024,
        name: fields.Name,
        parent: Number(fields.PPid),
        pid: Number(fields.Pid),
        rss: Number.parseInt(fields.VmRSS ?? "0", 10) * 1024,
      };
    }),
    time: Date.now(),
    workingSet: current - stats.inactive_file,
  };
}

async function status() {
  const response = await fetch(`${base}/api/debug/streams`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(5000),
  });

  assert.equal(response.status, 200);

  return (await response.json()).memory;
}

async function ready() {
  for (let i = 0; i < 160; i++) {
    try {
      const page = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(5000) });
      assert.equal(page.status, 200);
      await page.arrayBuffer();
      cookie = await accessCookie(base);
      await status();

      return;
    } catch {
      // Not serving yet; keep polling.
    }

    await delay(250);
  }

  throw new Error("Container did not become ready");
}

function upload(path, rate) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", [
      "--silent",
      "--cookie",
      cookie,
      "--show-error",
      "--fail-with-body",
      "--max-time",
      "90",
      ...(rate ? ["--limit-rate", rate] : []),
      "-F",
      `file=@${path}`,
      `${base}/api/uploads`,
    ]);

    let body = "",
      error = "";

    child.stdout.on("data", (chunk) => {
      body += chunk;
    });
    child.stderr.on("data", (chunk) => {
      error += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(JSON.parse(body)) : reject(new Error(error || body)),
    );
  });
}

const imageId = docker("inspect", container, "--format", "{{.Image}}");

const report = {
  container,
  createdAt: new Date().toISOString(),
  engineArchitecture: docker("info", "--format", "{{.Architecture}}"),
  healthcheck: JSON.parse(
    docker("inspect", container, "--format", "{{json .Config.Healthcheck.Test}}"),
  ),
  imageId,
  imagePlatform: docker("image", "inspect", imageId, "--format", "{{.Os}}/{{.Architecture}}"),
  nodeVersion: docker("exec", container, "node", "--version"),
  readiness: "Home page loaded, then one small multipart upload",
  runs: [],
  runtime: docker("exec", container, "uname", "-m"),
  threshold: limit,
};

await mkdir("work", { recursive: true });

// A real 3 s clip padded with zeros still probes as that clip, so the app stores it.
await writeFile(fixture, await readFile("fixtures/x.mp4"));

await truncate(fixture, 100 * 1024 * 1024);

// Uploads are stored by content hash; a run marker in the padding makes each run a new file.
async function markRun(index) {
  const handle = await open(fixture, "r+");

  try {
    await handle.write(`run ${index}`, 100 * 1024 * 1024 - 16);
  } finally {
    await handle.close();
  }
}

try {
  for (const [index, rate] of ["10M", "10M", undefined, undefined, "10M", "10M"].entries()) {
    const cold = index % 2 === 0;

    if (cold) {
      docker("restart", container);
      await ready();
    }

    await upload("fixtures/x.mp4");
    await markRun(index);
    const baselines = [];

    for (let i = 0; i < 5; i++) {
      baselines.push(snapshot());
      await delay(100);
    }

    const baseline = baselines.reduce((a, b) => (a.anon < b.anon ? a : b));
    const nodeBaseline = await status();
    const samples = [];
    let uploading = true;

    const pending = upload(fixture, rate).finally(() => {
      uploading = false;
    });

    while (uploading) {
      samples.push({ ...snapshot(), node: await status() });
      await delay(100);
    }

    const uploaded = await pending;
    assert.equal(uploaded.bytes, 100 * 1024 * 1024);
    await delay(500);
    const after = { ...snapshot(), node: await status() };
    const mainPid = baseline.processes.find((p) => p.parent === 1 && p.rss > 1024 * 1024)?.pid;
    assert.ok(mainPid, "Find the application process independently of health checks");
    const mainRss = (sample) => sample.processes.find((p) => p.pid === mainPid)?.rss ?? 0;
    const peak = (key) => Math.max(...samples.map((sample) => sample[key]));
    const peakNode = (key) => Math.max(...samples.map((sample) => sample.node[key]));

    const summary = {
      anonGrowth: peak("anon") - baseline.anon,
      applicationThresholdPassed:
        peak("anon") - baseline.anon < limit &&
        Math.max(...samples.map(mainRss)) - mainRss(baseline) < limit &&
        peakNode("arrayBuffers") < limit,
      arrayBuffersPeak: peakNode("arrayBuffers"),
      bytes: uploaded.bytes,
      cold,
      externalPeak: peakNode("external"),
      heapGrowth: peakNode("heapUsed") - nodeBaseline.heapUsed,
      mainRssGrowth: Math.max(...samples.map(mainRss)) - mainRss(baseline),
      originalThresholdPassed: peak("workingSet") - baseline.workingSet < limit,
      rate: rate ?? "unthrottled",
      run: index + 1,
      workingSetGrowth: peak("workingSet") - baseline.workingSet,
    };

    const healthChecks = JSON.parse(
      docker("inspect", container, "--format", "{{json .State.Health.Log}}"),
    ).map((entry) => ({
      end: entry.End,
      exitCode: entry.ExitCode,
      start: entry.Start,
    }));

    report.runs.push({
      after,
      baseline,
      healthChecks,
      nodeBaseline,
      samples,
      summary,
    });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(summary));
  }
} finally {
  await rm(fixture, { force: true });
}

if (report.runs.some((run) => !run.summary.applicationThresholdPassed)) {
  process.exitCode = 1;
}
