import { createFileRoute } from "@tanstack/react-router";
import { newJobSchema } from "#/lib/contracts";
import { submitJob } from "#/server/render-job.server";

export const Route = createFileRoute("/api/jobs")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const input = newJobSchema.safeParse(
					await request.json().catch(() => null),
				);
				if (!input.success)
					return Response.json(
						{ error: "Invalid render inputs" },
						{ status: 400 },
					);
				return Response.json(await submitJob(input.data), { status: 201 });
			},
		},
	},
});
