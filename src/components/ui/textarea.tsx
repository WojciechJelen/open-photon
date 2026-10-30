import * as React from "react"
import { cn } from "cn"

/**
 * Grows with its text, up to 240 px. `compact` starts at two lines rather than three; it cannot be
 * done with `rows`, which `field-sizing-content` ignores.
 */
function Textarea({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"textarea"> & { size?: "compact" | "default" }) {
  return (
    <textarea
      data-slot="textarea"
      data-size={size}
      className={cn(
        "flex field-sizing-content max-h-60 w-full data-[size=compact]:min-h-[calc(2lh+1.625rem)] data-[size=default]:min-h-24 resize-none rounded-field border border-input bg-field px-3.5 py-3 text-[15px] leading-normal wrap-anywhere text-foreground transition-[color,box-shadow,border-color] outline-none placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/20 disabled:cursor-not-allowed disabled:bg-foreground/4 disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
