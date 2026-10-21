import { Link } from "@tanstack/react-router";

import { CopyField } from "#/shared/components/copy-field";

/**
 * A done generation's public share link, `/r/<slug>` on `origin`, to copy or open. The page needs
 * no access code; it shows the result, the source clip and the recipe, which the line under the
 * link says.
 */
export function ShareLink({ origin, slug }: { origin: string; slug: string }) {
  return (
    <div className="flex flex-col gap-2">
      <CopyField
        copyLabel="Copy share link"
        iconOnly
        label="Share link"
        value={`${origin}/r/${slug}`}
      />
      <p className="text-sm text-muted-foreground">
        Anyone with it sees the result and the source clip.{" "}
        <Link
          className="text-soft-foreground underline decoration-edge-strong underline-offset-3 hover:text-foreground hover:decoration-brand"
          params={{ slug }}
          to="/r/$slug"
        >
          Open share page
        </Link>
      </p>
    </div>
  );
}
