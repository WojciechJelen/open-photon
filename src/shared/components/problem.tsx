import { CompassIcon, TriangleAlertIcon } from "lucide-react";

import { SitePage } from "#/shared/components/site";
import { StateCard } from "#/shared/components/state-card";

/** A page that could not be shown, inside the site: what happened, and `children`, the way back. */
export function Problem({
  children,
  text = "This page doesn't exist.",
  title,
  tone = "brand",
}: {
  children: React.ReactNode;
  text?: string;
  title: string;
  tone?: "brand" | "warning";
}) {
  return (
    <SitePage>
      <StateCard
        className="min-h-120"
        heading="h1"
        icon={tone === "warning" ? TriangleAlertIcon : CompassIcon}
        text={text}
        title={title}
        tone={tone}
      >
        {children}
      </StateCard>
    </SitePage>
  );
}
