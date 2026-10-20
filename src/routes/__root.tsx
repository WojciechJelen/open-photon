import { createRootRoute, HeadContent, Link, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";

import { Problem } from "#/shared/components/problem";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
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
    ],
  }),
  shellComponent: RootDocument,
  // A page that failed to load (a loader or render error) and a path no route has; each reloads
  // the studio, a fresh start.
  errorComponent: () => (
    <Problem title="Something went wrong">
      <p>This page could not be shown. Please try again.</p>
      <BackHome />
    </Problem>
  ),
  notFoundComponent: () => (
    <Problem title="Page not found">
      <p>There is nothing at this address.</p>
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
    <Link className="self-start text-foreground underline underline-offset-3" reloadDocument to="/">
      Back to Open Photon
    </Link>
  );
}
