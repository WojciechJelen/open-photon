import { createServerFn } from "@tanstack/react-start";
import { newJobSchema } from "#/lib/contracts";

export const createJob = createServerFn({ method: "POST" })
	.validator(newJobSchema)
	.handler(async ({ data }) => {
		const { insertJob } = await import("#/server/db.server");
		return insertJob(data);
	});
