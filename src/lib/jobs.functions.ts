import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { newJobSchema } from "#/lib/contracts";

export const createJob = createServerFn({ method: "POST" })
  // A schema validator would send the form a serialized ZodError; send its messages instead.
  .validator((input: z.input<typeof newJobSchema>) => {
    const parsed = newJobSchema.safeParse(input);

    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((issue) => issue.message).join(" "));
    }

    return parsed.data;
  })
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
