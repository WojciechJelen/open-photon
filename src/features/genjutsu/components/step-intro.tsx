import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowLeftIcon } from "lucide-react";

import type { WizardSearch } from "#/features/genjutsu/wizard";
import { Hud } from "#/shared/components/brand";

/**
 * A wizard screen's opening: the link back to the step before (`back`), "Step N of 4", the
 * heading the screen is labelled by, and one line on what to do.
 */
export function StepIntro({
  back,
  children,
  label,
  title,
}: {
  back?: { label: string; search: WizardSearch };
  children: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {back && (
        <Link
          className="-ml-1 inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-1 text-sm text-soft-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          search={back.search}
          to="/genjutsu"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          {back.label}
        </Link>
      )}
      {/* The compact header says it below `lg`. */}
      <Hud className="hidden lg:block">{label}</Hud>
      <h1
        className="font-display text-3xl leading-none font-bold tracking-display outline-none sm:text-4xl lg:text-5xl"
        tabIndex={-1}
      >
        {title}
      </h1>
      <p className="max-w-2xl text-base text-pretty text-soft-foreground sm:text-lg">{children}</p>
    </div>
  );
}

/** The advice under a grid: what makes a good clip or photo, one icon per point. */
export function TipsPanel({
  label,
  tips,
}: {
  label: string;
  tips: { icon: React.ReactNode; text: string; title: string }[];
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "grid gap-5 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-6 sm:grid-cols-2",
        tips.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4",
      )}
    >
      {tips.map((tip) => (
        <div className="flex items-start gap-3" key={tip.title}>
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-brand *:size-5">
            {tip.icon}
          </span>
          <div className="flex flex-col gap-0.5">
            <b className="text-sm">{tip.title}</b>
            <span className="text-sm text-soft-foreground">{tip.text}</span>
          </div>
        </div>
      ))}
    </section>
  );
}
