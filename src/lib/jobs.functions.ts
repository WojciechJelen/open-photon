import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { newJobSchema } from "#/lib/contracts";

export const createJob = createServerFn({ method: "POST" })
	.validator(newJobSchema)
	.handler(async ({ data }) => {
		const { submitJob } = await import("#/server/render-job.server");
		return submitJob(data);
	});

export const getJob = createServerFn({ method: "GET" })
	.validator(z.object({ id: z.uuid() }))
	.handler(async ({ data }) => {
		const { reconcileJob } = await import("#/server/render-job.server");
		return reconcileJob(data.id);
	});
