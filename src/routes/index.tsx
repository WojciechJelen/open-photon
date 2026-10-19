import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Open Photon</h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Film yourself moving, pick a character, and watch the character do the same. The screens for
        this are being built; there is nothing to use here yet.
      </p>
    </main>
  );
}
