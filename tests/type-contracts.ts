import { linkOptions } from "@tanstack/react-router";

import type { generate } from "../src/lib/generate.functions";
import type { Route as Home } from "../src/routes/index";

export function verifyContracts(
  result: Awaited<ReturnType<typeof generate>>,
  search: (typeof Home)["types"]["fullSearchSchema"],
  selection: (typeof Home)["types"]["loaderData"],
) {
  const id: string = result.id;
  const reused: boolean = result.reused;
  // The search schema feeds loaderDeps, which feeds the loader: both must stay typed.
  const motion: string | undefined = search.motion;
  const character: string | undefined = search.character;
  const title: string | undefined = selection.motions[0]?.title;
  const chosen: string | undefined = selection.character?.image.id;

  const link = linkOptions({ to: "/" });
  const picked = linkOptions({ search: { motion: id }, to: "/" });

  // @ts-expect-error A path outside the route tree must fail compilation.
  linkOptions({ to: "/studio" });
  // @ts-expect-error A search param outside the schema must fail compilation.
  linkOptions({ search: { nope: id }, to: "/" });
  // @ts-expect-error The server function's return must not degrade to any.
  const missing: string = result.nonexistentColumn;
  // @ts-expect-error The loader data must not degrade to any.
  const unknownField: string = selection.nonexistentField;

  return { character, chosen, id, link, missing, motion, picked, reused, title, unknownField };
}
