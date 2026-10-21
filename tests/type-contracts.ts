import { linkOptions } from "@tanstack/react-router";

import type { Route as Result } from "../src/routes/g.$generationId";
import type { Route as Home } from "../src/routes/index";
import type { Route as Wizard } from "../src/routes/motionTransfer";

export function verifyContracts(
  result: (typeof Result)["types"]["loaderData"],
  search: (typeof Wizard)["types"]["fullSearchSchema"],
  selection: (typeof Wizard)["types"]["loaderData"],
  studio: (typeof Home)["types"]["loaderData"],
) {
  const id: string = result.generation.id;
  const prerendered: boolean = result.prerendered;
  const resultSignedIn: boolean = result.signedIn;
  // The search schema feeds loaderDeps, which feeds the loader: both must stay typed.
  const motion: string | undefined = search.motion;
  const character: string | undefined = search.character;
  const step: "character" | "direct" | "motion" | undefined = search.step;
  const title: string | undefined = selection.motions[0]?.title;
  const chosen: string | undefined = selection.character?.image.id;
  const signedIn: boolean = selection.signedIn;
  const take: string | undefined = studio.sampleTake?.id;
  const freeTake: string | null = selection.sampleTakeId;

  const link = linkOptions({ to: "/" });
  // The studio home still takes the picks an old link names, to send them on to the wizard.
  const legacy = linkOptions({ search: { motion: id }, to: "/" });
  const picked = linkOptions({ search: { motion: id, step: "character" }, to: "/motionTransfer" });

  // @ts-expect-error A path outside the route tree must fail compilation.
  linkOptions({ to: "/nope" });
  // @ts-expect-error A search param outside the schema must fail compilation.
  linkOptions({ search: { nope: id }, to: "/motionTransfer" });
  // @ts-expect-error A step outside the wizard's must fail compilation.
  linkOptions({ search: { step: "render" }, to: "/motionTransfer" });
  // @ts-expect-error The loader data of `/g/:id` must not degrade to any.
  const missing: string = result.nonexistentColumn;
  // @ts-expect-error The loader data must not degrade to any.
  const unknownField: string = selection.nonexistentField;

  return {
    character,
    chosen,
    id,
    legacy,
    link,
    missing,
    motion,
    picked,
    prerendered,
    resultSignedIn,
    signedIn,
    step,
    freeTake,
    take,
    title,
    unknownField,
  };
}
