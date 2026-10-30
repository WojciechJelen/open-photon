import { ChevronDownIcon } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";

/**
 * A panel that opens on demand: its `icon` and `title`, a one-line `summary` beside it, and its
 * content.
 */
export function Disclosure({
  children,
  icon,
  summary,
  title,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  summary?: string;
  title: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card/72">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button
            className="group flex h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            type="button"
          >
            <span className="inline-flex min-w-0 items-center gap-2.5 type-label">
              {icon}
              <span className="truncate">{title}</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              {summary && (
                <span className="truncate" title={summary}>
                  {summary}
                </span>
              )}
              <ChevronDownIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 transition-transform group-aria-expanded:rotate-180"
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
