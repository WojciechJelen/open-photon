import { Link } from "@tanstack/react-router";
import { GithubIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { BrandMark, REPOSITORY_URL, StatusDot } from "#/shared/components/brand";

const footerLink =
  "inline-flex min-h-11 items-center text-sm text-soft-foreground underline decoration-edge-strong underline-offset-3 hover:text-foreground hover:decoration-brand";

/** "Open weights only": the badge every public page wears. */
export function OpenWeightsBadge() {
  return (
    <Badge>
      <StatusDot tone="ok" />
      Open weights only
    </Badge>
  );
}

/**
 * The header of the studio's public pages: the mark, the main navigation when `nav` is set
 * (Studio, Genjutsu, All tools), and `children` at the end.
 */
export function SiteHeader({
  children,
  nav = false,
}: {
  children: React.ReactNode;
  nav?: boolean;
}) {
  return (
    <header className="flex min-h-16 flex-wrap items-center gap-x-5 gap-y-1 border-b px-4 py-2.5 sm:px-8">
      <BrandMark />
      {nav && (
        <nav aria-label="Main" className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
          <Link
            aria-current="page"
            className="inline-flex min-h-11 items-center rounded-full bg-foreground/7 px-3.5 text-sm font-medium text-foreground"
            to="/"
          >
            Studio
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-medium text-soft-foreground hover:bg-foreground/5 hover:text-foreground"
            to="/genjutsu"
          >
            Genjutsu
          </Link>
          <a
            className="inline-flex min-h-11 items-center rounded-full px-3.5 text-sm font-medium text-soft-foreground hover:bg-foreground/5 hover:text-foreground"
            href="#tools"
          >
            All tools
          </a>
        </nav>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-3">{children}</div>
    </header>
  );
}

/** A link to the source on GitHub: an icon button on a phone, with its words from `sm`. */
export function GithubButton({ label }: { label: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <a href={REPOSITORY_URL}>
        <GithubIcon aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">{label}</span>
      </a>
    </Button>
  );
}

/** The studio footer: the license, and where the code and the workflow's provenance live. */
export function SiteFooter({ tagline }: { tagline: string }) {
  return (
    <footer className="mx-auto flex w-full max-w-330 flex-wrap items-center justify-between gap-4 border-t px-4 pt-8 pb-12 sm:px-8">
      <span className="text-sm text-soft-foreground">{tagline}</span>
      <nav aria-label="Footer" className="flex flex-wrap gap-x-5">
        <a className={footerLink} href={REPOSITORY_URL}>
          GitHub
        </a>
        <a
          className={footerLink}
          href={`${REPOSITORY_URL}/blob/main/src/features/genjutsu/workflows/README.md`}
        >
          Workflow and provenance
        </a>
        <a className={footerLink} href="https://www.comfy.org">
          Built on ComfyUI
        </a>
      </nav>
    </footer>
  );
}
