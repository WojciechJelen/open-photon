import * as React from "react"
import { cn } from "cn"
import { CircleIcon } from "lucide-react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

function RadioGroup({
  className,
  layout = "list",
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root> & {
  /** `cards`: option cards in a grid, two columns, four from `xl`. */
  layout?: "cards" | "list"
}) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      data-layout={layout}
      className={cn(
        "grid gap-3 data-[layout=cards]:grid-cols-2 data-[layout=cards]:gap-3.5 xl:data-[layout=cards]:grid-cols-4",
        className
      )}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "aspect-square size-5 shrink-0 cursor-pointer rounded-full border-[1.5px] border-edge-strong text-brand transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=checked]:border-brand",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 fill-brand" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
