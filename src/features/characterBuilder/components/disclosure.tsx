import { ChevronDownIcon } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";

/** A panel that opens on demand: its `title`, a one-line `summary` beside it, and its content. */
export function Disclosure({
  children,
  summary,
  title,
}: {
  children: React.ReactNode;
  summary?: string;
  title: string;
}) {
  return (
    <div className="rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button
            className="group flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            type="button"
          >
            <span className="font-semibold">{title}</span>
            <span className="inline-flex min-w-0 items-center gap-2.5 text-sm text-soft-foreground">
              {summary && <span className="truncate">{summary}</span>}
              <ChevronDownIcon
                aria-hidden="true"
                className="size-4 shrink-0 transition-transform group-aria-expanded:rotate-180"
              />
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-2 px-5 pb-5">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
