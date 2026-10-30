import { createRootRoute, HeadContent, Link, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";

import { Button } from "#/components/ui/button";
import favicon from "#/shared/assets/favicon.svg?url";
import { Problem } from "#/shared/components/problem";
import { loadSession } from "#/shared/session.functions";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  // The header knows the session from the first paint. A page's sign-in reads it again
  // (`router.invalidate()`); from then on `useSession` keeps it current, without a loader per route.
  loader: () => loadSession().catch(() => null),
  staleTime: Number.POSITIVE_INFINITY,
  head: () => ({
    meta: [
      {
        charSet: "utf8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        name: "theme-color",
        content: "#09080d",
      },
      {
        title: "Open Photon",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: favicon,
      },
    ],
  }),
  shellComponent: RootDocument,
  // A page that failed to load (a loader or render error) and a path no route has; each reloads
  // the studio, a fresh start.
  errorComponent: () => (
    <Problem
      text="This page could not be shown. Please try again."
      title="Something went wrong"
      tone="warning"
    >
      <BackHome />
    </Problem>
  ),
  notFoundComponent: () => (
    <Problem title="Nothing here">
      <BackHome />
    </Problem>
  ),
});

function RootDocument({ children }: { children: React.ReactNode }) {
  // Marks the page interactive: until React has hydrated, buttons and inputs do nothing. The
  // browser tests wait for it before they click.
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function BackHome() {
  return (
    <Button asChild variant="outline">
      <Link reloadDocument to="/">
        Back to Open Photon
      </Link>
    </Button>
  );
}
