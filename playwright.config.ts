import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3030",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  workers: 1,
});
