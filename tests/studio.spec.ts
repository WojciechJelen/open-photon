import { expect, test } from "@playwright/test";
import { jobRowSchema } from "../src/lib/contracts";

test("a saved live render is recoverable without submitting another generation", async ({
	page,
	request,
}) => {
	const id = process.env.WAN_TEST_JOB_ID;
	test.skip(
		!id,
		"Set WAN_TEST_JOB_ID to an existing completed render; this suite never submits a paid generation.",
	);
	if (!id) return;
	const response = await request.get(`/api/jobs/${id}`);
	const row = jobRowSchema.parse(await response.json());
	expect(row.status).toBe("complete");
	await page.goto(
		`/studio?preset=${row.preset}&take=${row.take}&job=${row.id}`,
	);
	await expect(page.getByTestId("progress-value")).toHaveText("100%");
	await expect(page.getByTestId("render-video")).toBeVisible();
	await expect(page.getByTestId("job-id")).toHaveText(id);
});

test("search validation keeps valid values and defaults invalid values", async ({
	page,
}) => {
	await page.goto("/studio?preset=portrait&take=3");
	await expect(page.getByTestId("preset")).toHaveText("portrait");
	await expect(page.getByTestId("take")).toHaveText("3");
	await page.goto("/studio?preset=unknown&take=-8");
	await expect(page.getByTestId("preset")).toHaveText("cinematic");
	await expect(page.getByTestId("take")).toHaveText("1");
});

test("SSE rejects invalid and missing jobs", async ({ request }) => {
	expect((await request.get("/api/jobs/not-a-uuid/events")).status()).toBe(400);
	expect(
		(await request.get(`/api/jobs/${crypto.randomUUID()}/events`)).status(),
	).toBe(404);
});

test("server validation rejects whitespace without creating a job", async ({
	page,
}) => {
	await page.goto("/studio");
	await page.getByLabel("Describe the character and background").fill("   ");
	await page.getByRole("button", { name: "Render on Comfy" }).click();
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(page.getByRole("heading", { name: "Saved render" })).toHaveCount(
		0,
	);
});
