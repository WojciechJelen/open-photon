import { ImageOffIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import type { CharacterSummary } from "#/features/characters/contracts";
import { uploadCharacter } from "#/features/characters/library";
import { StableText } from "#/shared/components/stable-text";
import { IMAGE_UPLOAD_TYPES } from "#/shared/image-upload";
import type { Refusal } from "#/shared/requests";
import type { HoldForCode } from "#/shared/use-access-code";
import { useRequestSignal } from "#/shared/use-request-signal";

// The key a photo waiting for the access code is held under (`useAccessCode`).
const HELD = "character-upload";

/** A picked file and its local preview URL (`URL.createObjectURL`), revoked once it is let go. */
type Photo = { file: File; preview: string };

type UploadState =
  | { kind: "idle" }
  | { kind: "picked"; photo: Photo }
  | { kind: "uploading"; photo: Photo }
  // `photo` is kept when trying it again may work (not for a file that is not an image).
  | { kind: "rejected"; photo: Photo | null; refusal: Refusal };

/** What a refusal says first, by its `reason` (a string the API answers with). */
const refusalTitles = new Map([
  ["consent_required", "Consent needed"],
  ["not_image", "Not an image"],
  ["rate_limited", "Too many uploads"],
  ["too_large", "Too large"],
]);

/**
 * Adds a photo to the workspace library: `trigger` is what the page shows (a button, a tile) and
 * gets the function that opens the file picker (a PNG, JPEG or WebP: `IMAGE_UPLOAD_TYPES`; the
 * server checks the content). The picked photo opens a dialog, so nothing on the page moves: its
 * preview, the likeness consent (`submitLabel` stays disabled without it) and `submitLabel`, which
 * uploads it (`POST /api/characters`). A refusal (`consent_required`, `not_image`, a limit) shows
 * there with a way on: "Try again" with the same file, or "Choose another". Closing the dialog lets
 * the photo go. A 401 holds the photo for the access code (`hold`) and uploads it as soon as the
 * code works.
 */
export function CharacterUpload({
  hold,
  onUploaded,
  release,
  submitLabel,
  trigger,
}: {
  hold: HoldForCode;
  onUploaded: (character: CharacterSummary) => void;
  release: (key: string) => void;
  submitLabel: string;
  trigger: (open: () => void) => ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [consent, setConsent] = useState(false);
  const nextSignal = useRequestSignal();

  const photo = state.kind === "idle" ? null : state.photo;
  const kept = photo?.preview;

  // The preview URL lives as long as the state keeps its photo.
  useEffect(() => (kept ? () => URL.revokeObjectURL(kept) : undefined), [kept]);
  useEffect(() => () => release(HELD), [release]);

  async function send(sent: Photo) {
    const signal = nextSignal();

    setState({ kind: "uploading", photo: sent });

    const result = await uploadCharacter(sent.file, signal);

    if (signal.aborted) {
      return;
    }

    if ("refusal" in result) {
      const { reason } = result.refusal;

      if (reason === "access_required") {
        setState({ kind: "picked", photo: sent });
        hold(HELD, "upload", () => void send(sent), { waits: true });
      } else {
        setState({
          kind: "rejected",
          photo: reason === "not_image" ? null : sent,
          refusal: result.refusal,
        });
      }

      return;
    }

    setState({ kind: "idle" });
    setConsent(false);
    onUploaded(result.data);
  }

  function pick(file: File) {
    release(HELD);
    setConsent(false);
    setState({ kind: "picked", photo: { file, preview: URL.createObjectURL(file) } });
  }

  function close() {
    // An upload on its way is cancelled with it.
    nextSignal();
    release(HELD);
    setConsent(false);
    setState({ kind: "idle" });
  }

  const busy = state.kind === "uploading";
  const refusal = state.kind === "rejected" ? state.refusal : null;
  const open = () => input.current?.click();

  return (
    <>
      {trigger(open)}
      <input
        accept={IMAGE_UPLOAD_TYPES.join(",")}
        aria-label="Upload a photo"
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const picked = event.target.files?.[0];

          event.target.value = "";

          if (picked) {
            pick(picked);
          }
        }}
        ref={input}
        tabIndex={-1}
        type="file"
      />
      <Dialog onOpenChange={(next) => !next && close()} open={state.kind !== "idle"}>
        <DialogContent data-reason={refusal?.reason} data-upload-state={state.kind} size="sm">
          <DialogHeader>
            <DialogTitle>Add a photo</DialogTitle>
            <DialogDescription>
              PNG, JPEG or WebP of one person, clearly lit, and only with their consent. It joins
              this workspace's shared library.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 items-start gap-4">
            <div className="relative aspect-4/7 w-24 shrink-0 overflow-hidden rounded-lg bg-screen shadow-hairline">
              {photo ? (
                <img
                  alt="The photo you picked"
                  className="absolute inset-0 size-full object-cover"
                  src={photo.preview}
                />
              ) : (
                <span className="absolute inset-0 grid place-items-center rounded-lg border border-dashed border-edge-strong text-muted-foreground">
                  <ImageOffIcon aria-hidden="true" className="size-5" strokeWidth={1.75} />
                </span>
              )}
            </div>
            {/* The picture's height is the room a refusal takes: the dialog keeps its size. */}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {photo && (
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={consent}
                    disabled={busy}
                    id={`${id}-consent`}
                    onCheckedChange={(checked) => setConsent(checked === true)}
                  />
                  <label
                    className="cursor-pointer text-sm leading-snug text-soft-foreground"
                    htmlFor={`${id}-consent`}
                  >
                    I may use this person's likeness: it's me, or they agreed to it.
                  </label>
                </div>
              )}
              {refusal && (
                <p
                  className="flex items-start gap-2 type-caption wrap-anywhere text-destructive-foreground"
                  role="alert"
                >
                  <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">
                    {refusal.reason && refusalTitles.has(refusal.reason) && (
                      <strong className="font-semibold">
                        {refusalTitles.get(refusal.reason)}.{" "}
                      </strong>
                    )}
                    {refusal.message}
                  </span>
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button disabled={busy} onClick={open} variant="ghost">
              Choose another
            </Button>
            <Button disabled={busy || !photo || !consent} onClick={() => photo && void send(photo)}>
              <StableText
                current={busy ? "Uploading…" : refusal && photo ? "Try again" : submitLabel}
                labels={[submitLabel, "Uploading…", "Try again"]}
              />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
