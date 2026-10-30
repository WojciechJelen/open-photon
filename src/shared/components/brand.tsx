import { Link } from "@tanstack/react-router";
import { cn } from "cn";

/** Where the source lives: the README says how to run it, and the code is MIT licensed. */
export const REPOSITORY_URL = "https://github.com/WojciechJelen/open-photon";

/** The Open Photon mark: a lens ring, the violet photon and a magenta spark. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-6 shrink-0", className)}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".35" strokeWidth="1.5" />
      <circle className="fill-brand" cx="12" cy="12" r="4" />
      <circle className="fill-brand-2" cx="19.1" cy="4.9" r="2" />
    </svg>
  );
}

/** The mark and the name, linking home to the studio. */
export function BrandMark() {
  return (
    <Link
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md type-brand whitespace-nowrap text-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring nav:gap-2.5"
      to="/"
    >
      <BrandLogo className="size-5.5 nav:size-6" />
      Open Photon
    </Link>
  );
}

/**
 * A HUD label: Geist Mono, small, uppercase, tracked out, like the readouts on a camera monitor.
 * `tone` lifts it from muted to the foreground or the brand tint.
 */
export function Hud({
  children,
  className,
  tone = "muted",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "brand" | "foreground" | "muted" | "soft";
}) {
  return (
    <span
      className={cn(
        "hud",
        tone === "muted" && "text-muted-foreground",
        tone === "soft" && "text-soft-foreground",
        tone === "foreground" && "text-foreground",
        tone === "brand" && "text-brand-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A status light: `ok` green, `brand` violet, `warning` amber, `danger` a steady red, or the red
 * `tally` of a camera that is rolling, which pulses (not for visitors who ask for reduced motion).
 */
export function StatusDot({ tone }: { tone: "brand" | "danger" | "ok" | "tally" | "warning" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full bg-current shadow-dot",
        tone === "ok" && "text-success",
        tone === "brand" && "text-brand",
        tone === "warning" && "text-warning",
        tone === "danger" && "text-destructive",
        tone === "tally" && "text-destructive motion-safe:animate-tally",
      )}
    />
  );
}

/** Viewfinder corner marks laid over a positioned media box. */
export function Viewfinder({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "brand" | "danger" | "dim" | "light";
}) {
  const corner = cn(
    "absolute size-4.5 border-0",
    tone === "light" && "border-foreground/85",
    tone === "dim" && "border-foreground/35",
    tone === "brand" && "border-brand",
    tone === "danger" && "border-destructive/70",
  );

  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute inset-3.5", className)}>
      <span className={cn(corner, "top-0 left-0 border-t-2 border-l-2")} />
      <span className={cn(corner, "top-0 right-0 border-t-2 border-r-2")} />
      <span className={cn(corner, "bottom-0 left-0 border-b-2 border-l-2")} />
      <span className={cn(corner, "right-0 bottom-0 border-r-2 border-b-2")} />
    </span>
  );
}
