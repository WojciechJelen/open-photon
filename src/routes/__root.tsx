import { createRootRoute, HeadContent, Link, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";

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
  // the picker, a fresh start.
  errorComponent: () => (
    <Problem title="Something went wrong">This page could not be shown. Please try again.</Problem>
  ),
  notFoundComponent: () => (
    <Problem title="Page not found">There is nothing at this address.</Problem>
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

function Problem({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
      <Link className="text-sm underline" reloadDocument to="/">
        Back to Open Photon
      </Link>
    </main>
  );
}
