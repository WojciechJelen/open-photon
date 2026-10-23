import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

import { storageStatePath } from "./tests/e2e/session.ts";

// The browser tests start their own dev servers, never reuse one, each on a fresh database seeded
// by `tests/e2e/seed.ts`:
// - at `BASE_URL`, Comfy at a dead port so no click can submit a paid job. The seeded `queued`
//   generation takes one place in flight, so two are allowed: a Generate then still goes to the
//   dead port at once (and fails), instead of waiting in line behind the seeded row, which the
//   dispatcher never moves on; a spec takes the second place to see a take wait in line.
// - at `FAKE_BASE_URL` (default: `BASE_URL`'s port + 1), the in-process fake provider
//   (`COMFY_PROVIDER=fake`, `src/shared/server/comfy-provider.fake.ts`), for a flow that needs a
//   generation to finish: the specs named `src/features/<feature>/tests/*.fake.spec.ts`, project
//   `fake`. Nothing there reaches a Comfy either.
// The rate limits are high enough for the whole run, which comes from one client with one code.
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3032";
const { hostname, port } = new URL(baseURL);

const fakeBaseURL = process.env.FAKE_BASE_URL ?? `http://${hostname}:${Number(port || 80) + 1}`;

const fake = new URL(fakeBaseURL);

const temporaryDatabase = (prefix: string) =>
  join(mkdtempSync(join(tmpdir(), prefix)), "app.sqlite");

// Workers load this file again; the variables they inherit keep them on the servers' databases.
process.env.E2E_DATABASE_PATH ??= temporaryDatabase("open-photon-e2e-");

process.env.E2E_FAKE_DATABASE_PATH ??= temporaryDatabase("open-photon-e2e-fake-");

const databasePath = process.env.E2E_DATABASE_PATH;
const fakeDatabasePath = process.env.E2E_FAKE_DATABASE_PATH;

const signedIn = { dependencies: ["sign-in"], use: { storageState: storageStatePath() } };

const fakeSpecs = "*/tests/*.fake.spec.ts";

/** One dev server: seeded first, on `url`'s host and port, with `env` over the run's defaults. */
function server(url: URL, database: string, env: Record<string, string>) {
  return {
    command: `node --experimental-strip-types tests/e2e/seed.ts && npx vite dev --host ${url.hostname} --port ${url.port} --strictPort`,
    env: {
      COMFY_API_KEY: "",
      COMFY_PROXY_TOKEN: "e2e-placeholder-not-a-key",
      COMFY_BASE_URL: "http://127.0.0.1:1",
      DATABASE_PATH: database,
      GENERATE_RATE_LIMIT: "1000",
      // Nitro's dev server takes `PORT` over Vite's `--port`: a worktree's own `PORT` would leave
      // the server's URL unanswered.
      PORT: url.port,
      UPLOAD_RATE_LIMIT: "1000",
      ...env,
    },
    reuseExistingServer: false,
    stdout: "pipe" as const,
    timeout: 120_000,
    url: `${url.origin}/healthz`,
  };
}

export default defineConfig({
  fullyParallel: false,
  projects: [
    { metadata: { databasePath }, name: "sign-in", testMatch: "e2e/sign-in.setup.ts" },
    { ...signedIn, name: "chromium", testIgnore: "**/*.fake.spec.ts", testMatch: "**/*.spec.ts" },
    // Each feature's own browser tests, under `src/features/<feature>/tests/`.
    {
      ...signedIn,
      name: "features",
      testDir: "./src/features",
      testIgnore: fakeSpecs,
      testMatch: "*/tests/*.spec.ts",
    },
    {
      metadata: { databasePath: fakeDatabasePath },
      name: "fake-sign-in",
      testMatch: "e2e/sign-in.setup.ts",
      use: { baseURL: fakeBaseURL },
    },
    // Each feature's browser tests of flows whose generations finish, on the fake provider.
    {
      dependencies: ["fake-sign-in"],
      name: "fake",
      testDir: "./src/features",
      testMatch: fakeSpecs,
      use: { baseURL: fakeBaseURL, storageState: storageStatePath(fakeDatabasePath) },
    },
  ],
  testDir: "./tests",
  timeout: 60_000,
  use: {
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    server(new URL(baseURL), databasePath, { IN_FLIGHT_MAX: "2" }),
    server(fake, fakeDatabasePath, {
      COMFY_FAKE_STEP_MS: "100",
      COMFY_PROVIDER: "fake",
      IN_FLIGHT_MAX: "4",
    }),
  ],
  workers: 1,
});
