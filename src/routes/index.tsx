import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FlaskConical } from "lucide-react";

import { buttonVariants } from "#/components/ui/button-variants";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <FlaskConical aria-hidden="true" className="size-10 text-primary" />
      <div className="space-y-4">
        <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
          Comfy / framework spike
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          One job. The whole stack.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Animate a character with Wan Animate 2. Submit to Comfy, follow live progress, and keep
          the finished MP4 on disk.
        </p>
      </div>
      <Link
        className={buttonVariants({ size: "lg", className: "w-fit" })}
        search={{ preset: "portrait", take: 1 }}
        to="/studio"
      >
        Open the studio <ArrowRight aria-hidden="true" />
      </Link>
      <p className="font-mono text-xs text-muted-foreground">
        TanStack Start v1 · Tailwind · shadcn/ui · SQLite · SSE
      </p>
    </main>
  );
}
