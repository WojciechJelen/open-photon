import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests",
	testMatch: "**/*.spec.ts",
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3030",
		browserName: "chromium",
		trace: "retain-on-failure",
	},
});
