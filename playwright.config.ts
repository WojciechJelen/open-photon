import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

import { storageStatePath } from "./tests/e2e/session.ts";

// The browser tests start their own dev server, never reuse one: on a fresh database seeded by
// `tests/e2e/seed.ts`, with Comfy at a dead port so no click can submit a paid job. The seeded
// `queued` generation takes one place in flight, so two are allowed; the rate limits are high
// enough for the whole run, which comes from one client with one code.
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3032";
const { hostname, port } = new URL(baseURL);

// Workers load this file again; the variable they inherit keeps them on the server's database.
process.env.E2E_DATABASE_PATH ??= join(
  mkdtempSync(join(tmpdir(), "open-photon-e2e-")),
  "app.sqlite",
);

export default defineConfig({
  fullyParallel: false,
  projects: [
    { name: "sign-in", testMatch: "e2e/sign-in.setup.ts" },
    {
      dependencies: ["sign-in"],
      name: "chromium",
      testMatch: "**/*.spec.ts",
      use: { storageState: storageStatePath() },
    },
  ],
  testDir: "./tests",
  timeout: 60_000,
  use: {
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node --experimental-strip-types tests/e2e/seed.ts && npx vite dev --host ${hostname} --port ${port} --strictPort`,
    env: {
      COMFY_API_KEY: "",
      COMFY_PROXY_TOKEN: "e2e-placeholder-not-a-key",
      COMFY_BASE_URL: "http://127.0.0.1:1",
      DATABASE_PATH: process.env.E2E_DATABASE_PATH,
      GENERATE_RATE_LIMIT: "1000",
      IN_FLIGHT_MAX: "2",
      UPLOAD_RATE_LIMIT: "1000",
    },
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 120_000,
    url: `${baseURL}/healthz`,
  },
  workers: 1,
});
