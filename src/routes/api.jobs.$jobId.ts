import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { findJob } from "#/server/db.server";
export const Route = createFileRoute("/api/jobs/$jobId")({
	server: {
		handlers: {
			GET: ({ params }) => {
				const id = z.uuid().safeParse(params.jobId);
				if (!id.success)
					return Response.json({ error: "Invalid job ID" }, { status: 400 });
				const job = findJob(id.data);
				return job
					? Response.json(job)
					: Response.json({ error: "Job not found" }, { status: 404 });
			},
		},
	},
});
