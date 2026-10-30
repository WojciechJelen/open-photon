import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";

import { Hud } from "#/shared/components/brand";

/** The card every board is built from, with its HUD `label` on top when it has one. */
export function Panel({
  children,
  className,
  label,
  ...props
}: Omit<ComponentProps<"div">, "title"> & { label?: ReactNode }) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-4.5 rounded-2xl border bg-card/72 p-5.5", className)}
      {...props}
    >
      {label && <Hud tone="soft">{label}</Hud>}
      {children}
    </div>
  );
}
