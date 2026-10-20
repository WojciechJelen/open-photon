import { cn } from "cn";
import { LockIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { tileFrame } from "#/features/genjutsu/components/pick-tile";
import type { Refusal } from "#/shared/requests";

// A refusal's title, keyed by the API's runtime `reason` string.
const rejectionTitles = new Map([
  ["consent_required", "Consent needed"],
  ["no_video", "No video"],
  ["not_image", "Not an image"],
  ["rate_limited", "Slow down"],
  ["too_large", "Too large"],
  ["too_short", "Too short"],
]);

/** The upload tile's frame for a state: dashed while idle, then violet, amber or red. */
export function uploadTileClass(tone: "busy" | "danger" | "idle" | "warning") {
  return cn(
    tileFrame,
    "flex flex-col items-center justify-center gap-3 p-5 text-center",
    tone === "idle" &&
      "border-dashed border-edge-strong bg-foreground/2 transition-colors hover:border-brand hover:bg-brand/6",
    tone === "warning" && "border-warning/50 bg-warning/5",
    tone === "busy" && "border-brand/50",
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
        "grid size-13 shrink-0 place-items-center rounded-full border",
        tone === "brand" && "border-brand/35 bg-brand/12 text-brand-foreground",
        tone === "warning" && "border-warning/40 bg-warning/12 text-warning-foreground",
        tone === "danger" && "border-destructive/40 bg-destructive/12 text-destructive-foreground",
      )}
    >
      {children}
    </span>
  );
}

/**
 * The idle state: the whole tile is the file input's label, so a click anywhere browses. The
 * input itself stays in the page (visually hidden) and takes the keyboard focus.
 */
export function IdleUpload({
  children,
  htmlFor,
  signedIn,
  title,
}: {
  children: React.ReactNode;
  htmlFor: string;
  signedIn: boolean;
  title: string;
}) {
  return (
    <label
      className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 p-5"
      htmlFor={htmlFor}
    >
      <StateIcon tone="brand">
        <UploadIcon className="size-5.5" />
      </StateIcon>
      <span className="font-semibold">{title}</span>
      {children}
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
      <span className="font-semibold">{title}</span>
      <span className="text-sm text-soft-foreground">{text}</span>
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
    <div className="flex flex-col items-center gap-3" role="alert">
      <StateIcon tone="danger">
        <TriangleAlertIcon className="size-5" />
      </StateIcon>
      <span className="font-semibold">
        {rejectionTitles.get(refusal.reason ?? "") ?? "Not used"}
      </span>
      <span className="text-sm text-soft-foreground">{refusal.message}</span>
      <Button onClick={onTryAnother} size="sm" variant="outline">
        Try another
      </Button>
    </div>
  );
}
