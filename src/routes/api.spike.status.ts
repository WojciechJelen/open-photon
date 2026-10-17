import { createFileRoute } from "@tanstack/react-router";
import { streamDiagnostics } from "#/server/fake-job.server";
export const Route = createFileRoute("/api/spike/status")({
	server: {
		handlers: {
			GET: () => {
				if (process.env.ENABLE_SPIKE_CHECKS !== "1")
					return new Response(null, { status: 404 });
				return Response.json({
					streams: streamDiagnostics(),
					memory: process.memoryUsage(),
				});
			},
		},
	},
});
