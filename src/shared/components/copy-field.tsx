import { cn } from "cn";
import { CheckIcon, CopyIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { StableText } from "#/shared/components/stable-text";

/** A link as the field shows it at rest: what tells it apart, `…/r/070c3d73`. */
function shortLink(value: string) {
  return value.replace(/^[a-z]+:\/\/[^/]+(?=\/)/, "…");
}

/**
 * A read-only link with a Copy button. It shows `shortLink` until it has the focus, then the whole
 * link, selected. Without clipboard permission (or a secure context) the link is left selected to
 * copy by hand, and a note floats under the field, so nothing moves. `iconOnly` shows the button as
 * an icon, named by `copyLabel`; `hideLabel` keeps the field's label for assistive technology only;
 * `labelEnd` sits on the label's line.
 */
export function CopyField({
  copyLabel,
  hideLabel = false,
  iconOnly = false,
  label,
  labelEnd,
  value,
}: {
  copyLabel: string;
  hideLabel?: boolean;
  iconOnly?: boolean;
  label: string;
  labelEnd?: ReactNode;
  value: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) {
      input.current?.select();
    }
  }, [focused]);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopy("copied");
    } catch {
      input.current?.focus();
      input.current?.select();
      setCopy("failed");
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {hideLabel ? (
        <span className="sr-only">
          <Label htmlFor={id}>{label}</Label>
        </span>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id}>{label}</Label>
          {labelEnd}
        </div>
      )}
      <div className="relative flex gap-2">
        <div className="min-w-0 flex-1 [&_input]:text-ellipsis">
          <Input
            id={id}
            onBlur={() => setFocused(false)}
            onFocus={() => setFocused(true)}
            readOnly
            ref={input}
            value={focused ? value : shortLink(value)}
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
          <Button onClick={copyValue} size="sm" type="button" variant="outline">
            {copy === "copied" ? <CheckIcon /> : <CopyIcon />}
            <StableText
              current={copy === "copied" ? "Copied" : copyLabel}
              labels={[copyLabel, "Copied"]}
            />
          </Button>
        )}
        <p
          aria-live="polite"
          className={cn(
            copy === "failed"
              ? "absolute inset-x-0 top-full z-1 mt-1.5 rounded-md border bg-popover px-2.5 py-1.5 type-caption text-soft-foreground shadow-menu"
              : "sr-only",
          )}
          role="status"
        >
          {copy === "copied"
            ? "Copied to the clipboard."
            : copy === "failed"
              ? "Copying is not allowed here; the link is selected, copy it by hand."
              : ""}
        </p>
      </div>
    </div>
  );
}
