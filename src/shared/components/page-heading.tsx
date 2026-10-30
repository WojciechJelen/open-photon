import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * A page's title, with its sentence under it and its `actions` to the right. The actions wrap
 * under the title when they no longer fit; a long title wraps, balanced, and never reaches them.
 */
export function PageHeading({
  actions,
  className,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  className?: string;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-8 gap-y-5", className)}>
      <div className="flex max-w-190 min-w-0 flex-col gap-1.5 sm:gap-2.5">
        <h1 className="type-title wrap-anywhere">{title}</h1>
        {subtitle && (
          <p className="type-lead text-pretty wrap-anywhere text-soft-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}
