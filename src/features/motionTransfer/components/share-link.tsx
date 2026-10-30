import { Link } from "@tanstack/react-router";

import { CopyField } from "#/shared/components/copy-field";

/**
 * A done generation's public share link, `/r/<slug>` on `origin`, to copy or open. The page needs
 * no access code; it shows the result, the source clip and the recipe.
 */
export function ShareLink({ origin, slug }: { origin: string; slug: string }) {
  return (
    <CopyField
      copyLabel="Copy share link"
      iconOnly
      label="Share link"
      labelEnd={
        <Link
          className="-my-3.5 min-w-0 truncate rounded-sm py-3.5 type-caption font-medium text-soft-foreground underline decoration-edge-strong underline-offset-3 hover:text-foreground hover:decoration-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          params={{ slug }}
          to="/r/$slug"
        >
          Open share page
        </Link>
      }
      value={`${origin}/r/${slug}`}
    />
  );
}
