import { expect, test } from "@playwright/test";
import { jobRowSchema } from "../src/lib/contracts";

test("typed link, SQLite server function, and incremental SSE work together", async ({
	page,
	request,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/");
	await page.getByRole("link", { name: "Open the studio" }).click();
	await expect(page).toHaveURL(/\/studio\?preset=cinematic&take=1$/);
	await expect(page.getByTestId("preset")).toHaveText("cinematic");
	await expect(page.getByTestId("take")).toHaveText("1");

	const prompt = `Browser proof ${crypto.randomUUID()}`;
	await page.getByLabel("Describe your shot").fill(prompt);
	await page.getByRole("button", { name: "Create job" }).click();
	await expect(
		page.getByRole("heading", { name: "Job saved to SQLite" }),
	).toBeVisible();
	await expect(page.getByTestId("progress-value")).toHaveText(/^[1-9][0-9]?%$/);
	await expect(page.getByTestId("progress-value")).toHaveText("100%", {
		timeout: 15000,
	});
	await expect(page.getByRole("status")).toContainText("Render complete");
	await expect(
		page.getByRole("progressbar", { name: "Render progress" }),
	).toHaveAttribute("aria-valuenow", "100");

	await page.getByText("View the returned row").click();
	const row = jobRowSchema.parse(
		JSON.parse(await page.getByTestId("saved-row").innerText()),
	);
	expect(row).toMatchObject({ prompt, preset: "cinematic", take: 1 });
	expect(await page.getByTestId("job-id").innerText()).toBe(row.id);

	const response = await request.get(`/api/jobs/${row.id}/events`);
	expect(response.headers()["content-type"]).toContain("text/event-stream");
	const events = (await response.text()).split("\n\n").filter(Boolean);
	expect(events.length).toBeGreaterThanOrEqual(1);
	expect(events.at(-1)).toContain('"kind":"complete"');
	expect(errors).toEqual([]);
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
	await page.getByLabel("Describe your shot").fill("   ");
	await page.getByRole("button", { name: "Create job" }).click();
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Job saved to SQLite" }),
	).toHaveCount(0);
});
