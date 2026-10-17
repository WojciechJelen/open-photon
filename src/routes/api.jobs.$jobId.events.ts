import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { findJob } from "#/server/db.server";
import { streamFakeJob } from "#/server/fake-job.server";

export const Route = createFileRoute("/api/jobs/$jobId/events")({
	server: {
		handlers: {
			GET: ({ request, params }) => {
				const id = z.uuid().safeParse(params.jobId);
				if (!id.success) return new Response("Invalid job ID", { status: 400 });
				if (!findJob(id.data))
					return new Response("Job not found", { status: 404 });
				return streamFakeJob(request, id.data);
			},
		},
	},
});
