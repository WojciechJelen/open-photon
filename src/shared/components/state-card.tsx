import { cn } from "cn";
import type { ComponentType, ReactNode } from "react";

import { Hud, Viewfinder } from "#/shared/components/brand";

/**
 * A whole box's empty, waiting or failed state, always the same height. `icon` sits on a disc
 * (`tone`: `brand`, `quiet` for one over a backdrop, `warning`); `backdrop` is a picture, blurred
 * and dimmed behind it all, so far that the card's text keeps 4.5:1 even over pure white; `frame` draws the dashed viewfinder of a result still to come, in place
 * of the icon. `children` are the actions or a progress bar. `heading` is `h1` when the card is the
 * page.
 */
export function StateCard({
  backdrop,
  children,
  className,
  frame = false,
  heading: Heading = "h2",
  icon: Icon,
  label,
  text,
  title,
  tone = "brand",
}: {
  backdrop?: string;
  children?: ReactNode;
  className?: string;
  frame?: boolean;
  heading?: "h1" | "h2" | "h3";
  icon?: ComponentType<{ "aria-hidden"?: boolean; className?: string; strokeWidth?: number }>;
  label?: string;
  text?: ReactNode;
  title: string;
  tone?: "brand" | "quiet" | "warning";
}) {
  return (
    <section
      aria-label={label ?? title}
      className={cn(
        "relative flex min-h-80 min-w-0 flex-col items-center justify-center gap-3.5 overflow-hidden rounded-2xl border bg-card/72 p-7 text-center",
        // Long content grows the card, and stays clear of the label.
        label && "py-11",
        className,
      )}
    >
      {label && (
        <span className="absolute inset-x-4.5 top-3.5 z-1 truncate text-left">
          <Hud tone={backdrop ? "soft" : "muted"}>{label}</Hud>
        </span>
      )}
      {backdrop && (
        <span aria-hidden="true" className="absolute inset-0">
          <img
            alt=""
            className="absolute inset-0 size-full scale-120 object-cover blur-backdrop brightness-28"
            src={backdrop}
          />
        </span>
      )}
      {frame && (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-x-7 bottom-7 rounded-field border border-dashed border-edge-strong",
              label ? "top-11" : "top-7",
            )}
          />
          <Viewfinder className="inset-14" tone="dim" />
        </>
      )}
      {Icon && (
        <span
          className={cn(
            "relative grid size-13 shrink-0 place-items-center rounded-full",
            tone === "brand" && "bg-brand/14 text-brand-foreground",
            tone === "quiet" && "bg-foreground/10 text-foreground",
            tone === "warning" && "bg-warning/14 text-warning",
          )}
        >
          <Icon aria-hidden={true} className="size-5" strokeWidth={1.75} />
        </span>
      )}
      <div className="relative flex w-full max-w-75 min-w-0 flex-col gap-1">
        <Heading className="type-card-title wrap-anywhere">{title}</Heading>
        {text && <p className="text-sm text-pretty wrap-anywhere text-soft-foreground">{text}</p>}
      </div>
      {children && (
        <div className="relative flex w-full flex-wrap items-center justify-center gap-2">
          {children}
        </div>
      )}
    </section>
  );
}
