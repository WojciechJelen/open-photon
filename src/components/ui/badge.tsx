import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "inline-flex min-h-7 w-fit shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full border px-3 font-mono text-[11px] font-medium tracking-[0.08em] whitespace-nowrap uppercase transition-[color,box-shadow] [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        // A HUD tag: mono, uppercase, quiet.
        default: "border-input bg-foreground/2 text-soft-foreground",
        // The photon accent: Beta, Open source.
        brand: "border-brand/45 bg-brand/8 text-brand-foreground",
        // Over media: a dark glass chip.
        solid: "border-foreground/12 bg-background/65 text-foreground backdrop-blur-md",
        warning: "border-warning/50 bg-warning/8 text-warning-foreground",
        destructive: "border-destructive/50 bg-destructive/8 text-destructive-foreground",
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
