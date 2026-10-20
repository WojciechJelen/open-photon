import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-transparent text-sm font-semibold whitespace-nowrap transition-[transform,background-color,border-color,box-shadow,color] outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:opacity-40 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The light "slate" button: the primary action of a screen.
        default:
          "bg-primary text-primary-foreground shadow-glow hover:bg-foreground",
        // The photon gradient: the one action that starts a render.
        photon:
          "bg-linear-100 from-brand via-brand-mid to-brand-2 text-primary-foreground shadow-glow-photon hover:-translate-y-px",
        destructive:
          "bg-destructive text-primary-foreground hover:bg-destructive/90",
        outline:
          "border-input bg-foreground/4 text-foreground hover:border-edge-strong hover:bg-foreground/8",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "text-soft-foreground hover:bg-accent hover:text-foreground",
        link: "rounded-sm font-medium text-soft-foreground underline decoration-edge-strong underline-offset-3 hover:text-foreground hover:decoration-brand",
        // A starter chip: toggles with `aria-pressed`.
        chip: "border-input font-medium text-soft-foreground hover:border-edge-strong hover:text-foreground aria-pressed:border-brand/70 aria-pressed:bg-brand/12 aria-pressed:text-foreground",
      },
      size: {
        default: "h-11 px-5 has-[>svg]:px-4",
        xs: "h-11 gap-1 px-3 text-xs",
        sm: "h-11 gap-1.5 px-4 text-[13px] has-[>svg]:px-3.5",
        lg: "h-13.5 px-7 text-[15px] has-[>svg]:px-6",
        // Text that reads like a link but keeps a 44 px touch target.
        inline: "h-11 px-1 text-[13px]",
        icon: "size-11",
        "icon-xs": "size-11 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-11",
        "icon-lg": "size-12 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
