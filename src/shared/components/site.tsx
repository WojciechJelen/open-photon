import { cn } from "cn";
import { GithubIcon, KeyRoundIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { Button } from "#/components/ui/button";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { BrandLogo, BrandMark, REPOSITORY_URL, StatusDot } from "#/shared/components/brand";
import { PoweredBy } from "#/shared/components/powered-by";
import {
  type NavigationCategory,
  PhoneMenu,
  SiteNavigation,
} from "#/shared/components/site-navigation";
import type { SessionStatus } from "#/shared/contracts";
import { useAccessCode } from "#/shared/use-access-code";
import { useSession } from "#/shared/use-session";

const footerLink =
  "-my-3.5 py-3.5 font-medium text-soft-foreground underline decoration-edge-strong underline-offset-3 hover:text-foreground hover:decoration-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

/** The header's end: what the session's code still allows, or the button that asks for a code. */
function SessionControl({
  onOpen,
  session,
}: {
  onOpen: () => void;
  session: SessionStatus | null;
}) {
  if (session) {
    const { remaining } = session.allowance;

    return (
      <span
        className="inline-flex h-9 items-center gap-2 rounded-full border px-3.5 type-caption font-medium whitespace-nowrap text-soft-foreground tabular-nums"
        title="What your access code still allows"
      >
        <StatusDot tone="ok" />
        {remaining} {remaining === 1 ? "render" : "renders"}
      </span>
    );
  }

  return (
    <Button onClick={onOpen} size="sm" variant="outline">
      <KeyRoundIcon aria-hidden="true" />
      Enter access code
    </Button>
  );
}

function GithubLink() {
  return (
    <Button asChild size="icon" variant="ghost">
      <a aria-label="Open Photon on GitHub" href={REPOSITORY_URL}>
        <GithubIcon aria-hidden="true" className="size-4.5" strokeWidth={1.75} />
      </a>
    </Button>
  );
}

/**
 * The one header of the site: the mark, the main navigation (`category` is the page's, marked
 * current), the session and GitHub. `onAccess` is what the page's own access-code dialog opens
 * with; a page without one leaves it out and the header brings its own. On a phone, all of it but
 * the mark is behind the menu button.
 */
function SiteHeader({
  category,
  onAccess,
}: {
  category?: NavigationCategory;
  onAccess?: () => void;
}) {
  const session = useSession();
  const own = useAccessCode();
  const openAccess = onAccess ?? own.unlock;

  return (
    <header className="flex h-15 items-center justify-between gap-x-6 gap-y-1.5 border-b pr-2 pl-4 nav:h-auto nav:min-h-16 nav:justify-start nav:px-page nav:py-2.5">
      <BrandMark />
      <div className="hidden nav:contents">
        <SiteNavigation category={category} />
        <div className="ml-auto flex items-center gap-2">
          {/* As wide as the code button, so the mark and the menus never move for what it shows. */}
          <div className="flex min-w-44 justify-end">
            <SessionControl onOpen={openAccess} session={session} />
          </div>
          <GithubLink />
        </div>
      </div>
      <PhoneMenu category={category}>
        {(close) => (
          <div className="flex items-center justify-between gap-2">
            <SessionControl
              onOpen={() => {
                close();
                openAccess();
              }}
              session={session}
            />
            <GithubLink />
          </div>
        )}
      </PhoneMenu>
      {!onAccess && <AccessCodeDialog {...own.dialog} />}
    </header>
  );
}

/** The one footer of the site: the project, where its code and provenance live, its partners. */
function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-330 px-page">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t pt-7 pb-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 type-caption text-muted-foreground">
          <span className="inline-flex items-center gap-2 font-medium text-soft-foreground">
            <BrandLogo className="size-4.5" />
            Open Photon
          </span>
          <span>Open source</span>
          <span>#OpenSourceHiggsfield</span>
          <a className={footerLink} href={REPOSITORY_URL}>
            GitHub
          </a>
          <a
            className={footerLink}
            href={`${REPOSITORY_URL}/blob/main/src/features/motionTransfer/workflows/README.md`}
          >
            Workflow and provenance
          </a>
        </div>
        <PoweredBy />
      </div>
    </footer>
  );
}

// `top` and `gap`: a page that opens on its title takes `top={10}`, so the title sits on one line
// across the site; 24 px leaves room for a row above it, and the home page's hero has 56 px.
const tops = { 6: "pt-6", 10: "pt-6 sm:pt-10", 14: "pt-7 sm:pt-14" } as const;
const gaps = { 6: "gap-6", 7: "gap-7", 8: "gap-7 sm:gap-8", 10: "gap-7 sm:gap-10" } as const;

/**
 * A page of the site: the header, `main` in the design's 1320 px column and the footer, with
 * `children` stacked in `main`. `top` and `gap` follow the page's board (Tailwind's scale: `10` is
 * 40 px); `className` adds to `main` for what those don't cover. See `SiteHeader` for `category`
 * and `onAccess`.
 */
export function SitePage({
  category,
  children,
  className,
  gap = 8,
  mainRef,
  onAccess,
  top = 10,
}: {
  category?: NavigationCategory;
  children: ReactNode;
  className?: string;
  gap?: keyof typeof gaps;
  mainRef?: Ref<HTMLElement>;
  onAccess?: () => void;
  top?: keyof typeof tops;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader category={category} onAccess={onAccess} />
      <main
        className={cn(
          "mx-auto flex w-full max-w-330 flex-1 flex-col px-page pb-10 sm:pb-16",
          tops[top],
          gaps[gap],
          className,
        )}
        ref={mainRef}
      >
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
