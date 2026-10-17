import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { newJobSchema } from "#/lib/contracts";

export const createJob = createServerFn({ method: "POST" })
	.validator(newJobSchema)
	.handler(async ({ data }) => {
		const { insertJob } = await import("#/server/db.server");
		return insertJob(data);
	});

export const getJob = createServerFn({ method: "GET" })
	.validator(z.object({ id: z.uuid() }))
	.handler(async ({ data }) => {
		const { findJob } = await import("#/server/db.server");
		return findJob(data.id);
	});
