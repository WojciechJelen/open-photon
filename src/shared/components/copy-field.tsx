import { CheckIcon, CopyIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";

/**
 * A read-only link with a Copy button. Without clipboard permission (or a secure context) the
 * link is left selected to copy by hand, and the page says so. `iconOnly` shows the button as an
 * icon, named by `copyLabel`; `hideLabel` keeps the field's label for assistive technology only.
 */
export function CopyField({
  copyLabel,
  hideLabel = false,
  iconOnly = false,
  label,
  value,
}: {
  copyLabel: string;
  hideLabel?: boolean;
  iconOnly?: boolean;
  label: string;
  value: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopy("copied");
    } catch {
      input.current?.select();
      setCopy("failed");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {hideLabel ? (
        <span className="sr-only">
          <Label htmlFor={id}>{label}</Label>
        </span>
      ) : (
        <Label htmlFor={id}>{label}</Label>
      )}
      <div className="flex gap-2">
        <div className="min-w-0 flex-1 font-mono">
          <Input
            id={id}
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            ref={input}
            value={value}
          />
        </div>
        {iconOnly ? (
          <Button
            aria-label={copyLabel}
            onClick={copyValue}
            size="icon-lg"
            type="button"
            variant="outline"
          >
            {copy === "copied" ? <CheckIcon /> : <CopyIcon />}
          </Button>
        ) : (
          <Button onClick={copyValue} type="button" variant="outline">
            {copy === "copied" ? <CheckIcon /> : <CopyIcon />}
            {copy === "copied" ? "Copied" : copyLabel}
          </Button>
        )}
      </div>
      <p aria-live="polite" className="text-sm text-soft-foreground empty:hidden" role="status">
        {copy === "copied"
          ? "Copied to the clipboard."
          : copy === "failed"
            ? "Copying is not allowed here; the link is selected, copy it by hand."
            : ""}
      </p>
    </div>
  );
}
