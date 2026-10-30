import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "inline-flex h-6.5 w-fit max-w-full shrink-0 items-center justify-center gap-[7px] overflow-hidden rounded-full border px-2.5 font-mono text-[11px] font-medium tracking-[0.1em] whitespace-nowrap uppercase transition-[color,box-shadow] [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        // A status pill: mono, uppercase, quiet.
        default: "border-input text-soft-foreground",
        // The photon accent: Rendering, Beta, Open source.
        brand: "border-brand/40 text-brand-foreground",
        // Over media: a dark chip, no line.
        solid: "border-transparent bg-background/72 text-foreground",
        warning: "border-warning/50 text-warning-foreground",
        destructive: "border-destructive/50 text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
