import { Link, useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowLeftIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button";
import { PageHeading } from "#/shared/components/page-heading";
import { Panel } from "#/shared/components/panel";
import { SitePage } from "#/shared/components/site";
import { StateCard } from "#/shared/components/state-card";

/** The gallery's tiles: as many columns as fit, the same width however few tiles a filter leaves. */
export const tileGrid = "grid tiles-fill-43 gap-3";

/** One of a take's two figures, the source and the take: side by side, even on a phone. */
export const takeFigure = "m-0 flex max-w-82.5 min-w-0 grow basis-32 flex-col gap-2.5";

/** Explore's page shell: the site header (Explore marks itself current), the page, the footer. */
export function ExploreFrame({ children }: { children: ReactNode }) {
  return <SitePage gap={7}>{children}</SitePage>;
}

/** A take's page shell: closer to the header, and tighter, than the gallery's. */
export function TakeFrame({ children }: { children: ReactNode }) {
  return (
    <SitePage className="gap-4" gap={6} top={6}>
      {children}
    </SitePage>
  );
}

/** The gallery's heading: what Explore is. */
export function ExploreHeading() {
  return (
    <PageHeading
      subtitle="Open one, or make it with your own character."
      title="Finished takes, ready to remake"
    />
  );
}

/** Back to the gallery: 32 px in the page's rhythm, a 44 px target. */
export function AllTakesLink() {
  return (
    <Link
      className="-my-1.5 inline-flex h-11 w-fit max-w-full items-center gap-1.5 rounded-sm type-caption font-medium text-soft-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
      to="/explore"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">All takes</span>
    </Link>
  );
}

/** A take's two figures (`children`) and `aside`, which wraps under them when both no longer fit. */
export function TakeColumns({ aside, children }: { aside: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-10">
      <section
        aria-label="Source and result"
        className="flex min-w-0 grow-999 basis-140 flex-wrap gap-4"
      >
        {children}
      </section>
      <aside aria-label="The recipe" className="flex min-w-0 grow basis-85 flex-col gap-2">
        {aside}
      </aside>
    </div>
  );
}

/** A tile's footprint before it has anything to show: its picture and its caption line. */
export function TileSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5", className)}>
      <div className="aspect-9/16 skeleton rounded-field" />
      <span className="type-label">&nbsp;</span>
    </div>
  );
}

/** While the gallery loads: the page as it will be, placeholders where the takes will be. */
export function ExploreLoading({ label }: { label: string }) {
  return (
    <ExploreFrame>
      <ExploreHeading />
      <p className="sr-only" role="status">
        {label}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="h-11 w-60 max-w-full skeleton rounded-full" />
        <div className={tileGrid}>
          {Array.from({ length: 6 }, (_, index) => (
            <TileSkeleton key={index} />
          ))}
        </div>
      </div>
    </ExploreFrame>
  );
}

/** While a take's page loads: its two figures and its recipe, in their places. */
export function TakeLoading({ label }: { label: string }) {
  return (
    <TakeFrame>
      <AllTakesLink />
      <p className="sr-only" role="status">
        {label}
      </p>
      <div aria-hidden="true" className="contents">
        <div className="w-full max-w-120 skeleton rounded-lg type-title">
          &nbsp;
          <br className="sm:hidden" />
          &nbsp;
        </div>
        <TakeColumns
          aside={
            <>
              <Panel className="min-h-102 motion-safe:animate-pulse" />
              <div className="h-11" />
            </>
          }
        >
          {["source", "take"].map((figure) => (
            <div className={takeFigure} key={figure}>
              <div className="aspect-9/16 skeleton rounded-xl" />
              <div>
                <span className="hud">&nbsp;</span>
              </div>
            </div>
          ))}
        </TakeColumns>
      </div>
    </TakeFrame>
  );
}

/** When a page of Explore could not be loaded: said so, with Try again and a way out. */
export function ExploreError({ title }: { title: string }) {
  const router = useRouter();

  return (
    <ExploreFrame>
      <div role="alert">
        <StateCard
          className="min-h-120"
          heading="h1"
          icon={TriangleAlertIcon}
          text="Something went wrong on the way. Nothing was started; try again in a moment."
          title={title}
          tone="warning"
        >
          <Button onClick={() => void router.invalidate()}>
            <RotateCwIcon aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Studio home</Link>
          </Button>
        </StateCard>
      </div>
    </ExploreFrame>
  );
}
