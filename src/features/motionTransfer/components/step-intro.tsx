import { cn } from "cn";
import type { LucideIcon } from "lucide-react";

import { PageHeading } from "#/shared/components/page-heading";

/**
 * A wizard screen's opening: the heading the screen is labelled by, which takes the focus on a new
 * step and draws no ring for it, and one line on what to do.
 */
export function StepIntro({ children, title }: { children: React.ReactNode; title: string }) {
  return <PageHeading className="[&_h1]:outline-none" subtitle={children} title={title} />;
}

/** The advice on a step, one icon per point. Spans: it also sits in the upload tile's label. */
export function StepTips({
  className,
  tips,
}: {
  className?: string;
  tips: { icon: LucideIcon; text: string }[];
}) {
  return (
    <span className={cn("flex flex-wrap gap-x-6 gap-y-2", className)}>
      {tips.map(({ icon: Icon, text }) => (
        <span
          className="inline-flex min-w-0 items-center gap-2 type-caption text-soft-foreground"
          key={text}
        >
          <Icon aria-hidden="true" className="size-3.75 shrink-0 text-brand" strokeWidth={1.75} />
          <span className="min-w-0 wrap-anywhere">{text}</span>
        </span>
      ))}
    </span>
  );
}
