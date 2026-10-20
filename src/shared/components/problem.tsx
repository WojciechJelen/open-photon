import { BrandMark, Hud, PageGlow } from "#/shared/components/brand";

/** A page that could not be shown: what happened, and `children`, the way back. */
export function Problem({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <header className="flex min-h-16 items-center border-b px-4 sm:px-8">
        <BrandMark />
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-20 sm:px-8">
        <Hud>Cut</Hud>
        <h1 className="font-display text-4xl leading-none font-bold tracking-display">{title}</h1>
        <div className="flex flex-col gap-3 text-soft-foreground">{children}</div>
      </main>
    </div>
  );
}
