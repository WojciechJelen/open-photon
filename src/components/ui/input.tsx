import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-field border border-input bg-field px-3.5 py-1 text-[15px] text-foreground transition-[color,box-shadow,border-color] outline-none selection:bg-brand/40 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-foreground/4 disabled:text-muted-foreground read-only:text-soft-foreground",
        "focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/20",
        "aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
