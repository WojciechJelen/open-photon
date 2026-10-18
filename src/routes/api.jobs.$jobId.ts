import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { reconcileJob } from "#/server/render-job.server";

export const Route = createFileRoute("/api/jobs/$jobId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const id = z.uuid().safeParse(params.jobId);

        if (!id.success) {
          return Response.json({ error: "Invalid job ID" }, { status: 400 });
        }

        const job = await reconcileJob(id.data, request.signal);

        return job
          ? Response.json(job)
          : Response.json({ error: "Job not found" }, { status: 404 });
      },
    },
  },
});
