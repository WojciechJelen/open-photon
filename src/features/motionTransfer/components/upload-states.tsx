import { cn } from "cn";
import { LockIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import type { Refusal } from "#/shared/requests";

// A refusal's title, keyed by the API's runtime `reason` string.
const rejectionTitles = new Map([
  ["no_video", "No video"],
  ["rate_limited", "Slow down"],
  ["too_large", "Too large"],
  ["too_short", "Too short"],
]);

/**
 * The upload tile's frame for a state: dashed while idle, then violet, amber or red. The border
 * only changes color, so a state keeps the tile's box.
 */
export function uploadTileClass(tone: "busy" | "danger" | "idle" | "warning") {
  return cn(
    "relative flex min-w-0 flex-col items-center justify-center gap-3.5 rounded-field border p-8 text-center text-foreground",
    tone === "idle" &&
      "border-dashed border-edge-strong bg-foreground/2 transition-colors hover:border-brand hover:bg-brand/6",
    tone === "warning" && "border-warning/50 bg-warning/5",
    tone === "busy" && "border-brand/50 bg-foreground/2",
    tone === "danger" && "border-destructive/55 bg-destructive/5",
  );
}

/** The round icon at the top of a state. */
export function StateIcon({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "brand" | "danger" | "warning";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-13 shrink-0 place-items-center rounded-full",
        tone === "brand" && "bg-brand/14 text-brand-foreground",
        tone === "warning" && "bg-warning/14 text-warning-foreground",
        tone === "danger" && "bg-destructive/14 text-destructive-foreground",
      )}
    >
      {children}
    </span>
  );
}

/**
 * The idle state: the whole tile is the file input's label, so a click anywhere browses, "Choose a
 * clip" included (it only looks like a button). The input itself stays in the page (visually
 * hidden) and takes the keyboard focus. `children` is more to say under it, in phrasing content.
 */
export function IdleUpload({
  choose,
  children,
  hint,
  htmlFor,
  signedIn,
  title,
}: {
  choose: string;
  children?: React.ReactNode;
  hint: string;
  htmlFor: string;
  signedIn: boolean;
  title: string;
}) {
  return (
    <label
      className="-m-8 flex flex-1 cursor-pointer flex-col items-center justify-center gap-3.5 self-stretch p-8"
      htmlFor={htmlFor}
    >
      <StateIcon tone="brand">
        <UploadIcon className="size-5" strokeWidth={1.75} />
      </StateIcon>
      <span aria-hidden="true" className="flex max-w-full min-w-0 flex-col gap-0.5 wrap-anywhere">
        <span className="text-base font-semibold">{title}</span>
        <span className="type-caption text-muted-foreground">{hint}</span>
      </span>
      <Button asChild variant="outline">
        <span>{choose}</span>
      </Button>
      {children && (
        <span aria-hidden="true" className="max-w-full min-w-0">
          {children}
        </span>
      )}
      {!signedIn && (
        <Badge>
          <LockIcon />
          Needs access code
        </Badge>
      )}
    </label>
  );
}

/** A state that waits on the server: three pulsing dots, what it does, and how. */
export function WorkingState({ text, title }: { text: string; title: string }) {
  return (
    <>
      <span aria-hidden="true" className="flex gap-1.5">
        <span className="size-1.5 rounded-full bg-brand motion-safe:animate-pulse" />
        <span className="size-1.5 rounded-full bg-brand motion-safe:animate-pulse" />
        <span className="size-1.5 rounded-full bg-brand motion-safe:animate-pulse" />
      </span>
      <span className="max-w-full text-base font-semibold wrap-anywhere">{title}</span>
      <span className="max-w-full type-caption wrap-anywhere text-soft-foreground">{text}</span>
    </>
  );
}

/** A refused file, as an alert: why, in the server's words, and a way to pick another. */
export function RejectedState({
  onTryAnother,
  refusal,
}: {
  onTryAnother: () => void;
  refusal: Refusal;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-3.5" role="alert">
      <StateIcon tone="danger">
        <TriangleAlertIcon className="size-5" strokeWidth={1.75} />
      </StateIcon>
      <span className="flex max-w-full min-w-0 flex-col gap-0.5">
        <span className="text-base font-semibold wrap-anywhere">
          {rejectionTitles.get(refusal.reason ?? "") ?? "Not used"}
        </span>
        <span className="line-clamp-4 type-caption wrap-anywhere text-soft-foreground">
          {refusal.message}
        </span>
      </span>
      <Button onClick={onTryAnother} size="sm" variant="outline">
        Try another
      </Button>
    </div>
  );
}
