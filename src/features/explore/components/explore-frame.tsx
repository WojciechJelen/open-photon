import { Link, useRouter } from "@tanstack/react-router";
import { RotateCwIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Hud, PageGlow } from "#/shared/components/brand";
import { OpenWeightsBadge, SiteFooter, SiteHeader } from "#/shared/components/site";

/** Explore's page shell: the site header (Explore marks itself current), the page, the footer. */
export function ExploreFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate">
      <PageGlow />
      <SiteHeader>
        <span className="hidden sm:inline-flex">
          <OpenWeightsBadge />
        </span>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-330 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
        {children}
      </main>
      <SiteFooter tagline="Open Photon · MIT licensed · Made for #OpenSourceHiggsfield" />
    </div>
  );
}

/** The gallery's heading: what Explore is. */
export function ExploreHeading() {
  return (
    <div className="flex flex-col gap-3">
      <Hud>Explore</Hud>
      <h1 className="font-display text-4xl leading-none font-bold tracking-display sm:text-5xl">
        Finished takes, ready to remake
      </h1>
      <p className="max-w-prose text-soft-foreground">
        Sample characters performing sample motions, rendered with open weights. Open one for the
        source beside the result and its recipe, or make it with your own character.
      </p>
    </div>
  );
}

/** While a page of Explore loads: placeholders where the examples will be. */
export function ExploreLoading({ label }: { label: string }) {
  return (
    <ExploreFrame>
      <p className="text-sm text-muted-foreground" role="status">
        {label}
      </p>
      <ul
        aria-hidden="true"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
      >
        {Array.from({ length: 4 }, (_, index) => (
          <li
            className="aspect-9/16 rounded-xl border bg-card motion-safe:animate-pulse"
            key={index}
          />
        ))}
      </ul>
    </ExploreFrame>
  );
}

/** When a page of Explore could not be loaded: said so, with Try again and a way out. */
export function ExploreError({ title }: { title: string }) {
  const router = useRouter();

  return (
    <ExploreFrame>
      <div className="flex flex-col items-start gap-4" role="alert">
        <h1 className="font-display text-3xl leading-none font-bold tracking-display">{title}</h1>
        <p className="text-soft-foreground">
          Something went wrong on the way. Nothing was started; try again in a moment.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void router.invalidate()}>
            <RotateCwIcon aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Studio home</Link>
          </Button>
        </div>
      </div>
    </ExploreFrame>
  );
}
