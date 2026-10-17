import { createFileRoute } from "@tanstack/react-router";
import { newJobSchema } from "#/lib/contracts";
import { insertJob } from "#/server/db.server";
export const Route = createFileRoute("/api/spike/jobs")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				if (process.env.ENABLE_SPIKE_CHECKS !== "1")
					return new Response(null, { status: 404 });
				const parsed = newJobSchema.safeParse(await request.json());
				return parsed.success
					? Response.json(insertJob(parsed.data), { status: 201 })
					: Response.json({ error: "Invalid test job" }, { status: 400 });
			},
		},
	},
});
