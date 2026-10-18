import { linkOptions } from "@tanstack/react-router";
import type { z } from "zod";

import type { jobRowSchema } from "../src/lib/contracts";
import type { createJob } from "../src/lib/jobs.functions";

export function verifyContracts(row: Awaited<ReturnType<typeof createJob>>) {
  const savedRow: z.infer<typeof jobRowSchema> = row;

  const link = linkOptions({
    search: { preset: "cinematic", take: 1 },
    to: "/studio",
  });

  linkOptions({
    to: "/studio",
    // @ts-expect-error A preset outside validateSearch's output must fail compilation.
    search: { preset: "unsupported", take: 1 },
  });
  // @ts-expect-error The server function's return must not degrade to any.
  const missing: string = row.nonexistentColumn;

  return { link, missing, savedRow };
}
