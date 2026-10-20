import { Link } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";

/**
 * A done generation's public share link, `/r/<slug>` on `origin`, to copy or open. The page needs
 * no access code; it shows the result, the source clip and the recipe.
 */
export function ShareLink({ origin, slug }: { origin: string; slug: string }) {
  const url = `${origin}/r/${slug}`;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      // No clipboard permission (or no secure context): leave the link selected to copy by hand.
      input.current?.select();
      setCopy("failed");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Share link</Label>
      <div className="flex flex-wrap gap-2">
        <div className="max-w-md flex-1">
          <Input
            id={id}
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            ref={input}
            value={url}
          />
        </div>
        <Button onClick={copyLink} type="button" variant="outline">
          {copy === "copied" ? "Copied" : "Copy link"}
        </Button>
        <Button asChild variant="link">
          <Link params={{ slug }} to="/r/$slug">
            Open share page
          </Link>
        </Button>
      </div>
      {copy === "failed" && (
        <p className="text-sm" role="status">
          Copying is not allowed here; the link is selected, copy it by hand.
        </p>
      )}
    </div>
  );
}
