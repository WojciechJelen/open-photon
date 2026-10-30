import type { ReactNode } from "react";

/** A short description list: each term beside its value from `sm`, above it on a phone. */
export function Facts({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="flex flex-col gap-2.5 type-caption">
      {items.map(([term, value]) => (
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3" key={term}>
          <dt className="shrink-0 text-muted-foreground sm:w-28">{term}</dt>
          <dd className="min-w-0 wrap-anywhere text-soft-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
