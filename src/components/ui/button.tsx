import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex max-w-full shrink-0 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full border border-transparent text-sm font-semibold tracking-[-0.005em] whitespace-nowrap transition-[background-color,border-color,box-shadow,color,filter] outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring disabled:cursor-not-allowed disabled:border-transparent disabled:bg-foreground/6 disabled:bg-none disabled:text-muted-foreground disabled:shadow-none disabled:brightness-100 aria-disabled:pointer-events-none aria-disabled:border-transparent aria-disabled:bg-foreground/6 aria-disabled:bg-none aria-disabled:text-muted-foreground aria-disabled:shadow-none aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&>span]:min-w-0 [&>span]:truncate",
  {
    variants: {
      variant: {
        // The light "slate" button: the primary action of a screen.
        default: "bg-primary text-primary-foreground hover:bg-foreground",
        // The photon gradient: the one action that starts a render.
        photon:
          "bg-render bg-origin-border text-primary-foreground shadow-glow-photon hover:brightness-110",
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
        // Over a picture, in `ResultFigure`'s scrim.
        scrim:
          "border-input bg-background/70 text-foreground hover:bg-background/90",
      },
      size: {
        default: "h-11 px-5",
        xs: "h-11 px-3.5",
        sm: "h-11 px-3.5",
        // An item of the main navigation, medium until it is current.
        nav: "h-11 gap-1.5 px-3.5 font-medium data-current:bg-accent data-current:font-semibold data-current:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
        lg: "h-11 px-5",
        // Text that reads like a link but keeps a 44 px touch target.
        inline: "h-11 px-1 text-[13px]",
        icon: "size-11",
        "icon-xs": "size-11",
        "icon-sm": "size-11",
        "icon-lg": "size-11",
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
