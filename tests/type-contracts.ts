import { linkOptions } from "@tanstack/react-router";

import type { generate } from "../src/lib/generate.functions";

export function verifyContracts(result: Awaited<ReturnType<typeof generate>>) {
  const id: string = result.id;
  const reused: boolean = result.reused;

  const link = linkOptions({ to: "/" });

  // @ts-expect-error A path outside the route tree must fail compilation.
  linkOptions({ to: "/studio" });
  // @ts-expect-error The server function's return must not degrade to any.
  const missing: string = result.nonexistentColumn;

  return { id, link, missing, reused };
}
