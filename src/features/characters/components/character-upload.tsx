import { cn } from "cn";
import { ImageUpIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import type { CharacterSummary } from "#/features/characters/contracts";
import { uploadCharacter, uploadTypes } from "#/features/characters/library";
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
  // `photo` is kept when trying it again may work (not for a file that is not an image); with
  // the character chosen when it came: choosing another one clears it.
  | { kind: "rejected"; photo: Photo | null; refusal: Refusal; selectedId: string | undefined };

/** What a refusal says first, by its `reason` (a string the API answers with). */
const refusalTitles = new Map([
  ["consent_required", "Consent needed"],
  ["not_image", "Not an image"],
  ["rate_limited", "Too many uploads"],
  ["too_large", "Too large"],
]);

/**
 * Adds a photo to the workspace library: pick a PNG, JPEG or WebP, tick the likeness consent
 * (the upload button stays disabled without it), and `submitLabel` uploads it
 * (`POST /api/characters`). A refusal (`consent_required`, `not_image`, a limit; the file picker
 * offers `uploadTypes`, the server checks the content) shows with a way on: "Try again" with the
 * same file, or "Choose another"; it clears when another character is chosen (`selectedId`). A
 * 401 holds the photo for the access code (`hold`) and uploads it as soon as the code works.
 */
export function CharacterUpload({
  className,
  hold,
  onUploaded,
  release,
  selectedId,
  submitLabel,
}: {
  className?: string;
  hold: HoldForCode;
  onUploaded: (character: CharacterSummary) => void;
  release: (key: string) => void;
  selectedId?: string;
  submitLabel: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [consent, setConsent] = useState(false);
  const nextSignal = useRequestSignal();

  const shown: UploadState =
    state.kind === "rejected" && state.selectedId !== selectedId ? { kind: "idle" } : state;

  const photo = shown.kind === "idle" ? null : shown.photo;
  const kept = state.kind === "idle" ? null : state.photo?.preview;

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
          selectedId,
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

  const busy = shown.kind === "uploading";
  const refusal = shown.kind === "rejected" ? shown.refusal : null;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn("flex flex-col gap-4 rounded-xl border bg-card p-4", className)}
      data-reason={refusal?.reason}
      data-upload-state={shown.kind}
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold" id={`${id}-title`}>
          Add a photo
        </h2>
        <p className="text-sm text-muted-foreground" id={`${id}-rules`}>
          PNG, JPEG or WebP of one person, clearly lit, and only with their consent. It joins this
          workspace's shared library.
        </p>
      </div>
      <input
        accept={uploadTypes.join(",")}
        aria-describedby={`${id}-rules`}
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
      {photo && (
        <div className="flex items-start gap-4">
          <div className="relative aspect-3/4 w-24 shrink-0 overflow-hidden rounded-lg bg-screen">
            <img
              alt="The photo you picked"
              className="absolute inset-0 size-full object-cover"
              src={photo.preview}
            />
          </div>
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
        </div>
      )}
      {refusal && (
        <p className="flex items-start gap-2 text-sm text-destructive-foreground" role="alert">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {refusal.reason && refusalTitles.has(refusal.reason) && (
              <strong className="font-semibold">{refusalTitles.get(refusal.reason)}. </strong>
            )}
            {refusal.message}
          </span>
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {photo && (
          <Button disabled={busy || !consent} onClick={() => void send(photo)} size="sm">
            {busy ? "Uploading…" : refusal ? "Try again" : submitLabel}
          </Button>
        )}
        <Button
          disabled={busy}
          onClick={() => input.current?.click()}
          size="sm"
          variant={photo ? "ghost" : "outline"}
        >
          <ImageUpIcon aria-hidden="true" />
          {shown.kind === "idle" ? "Choose photo" : "Choose another"}
        </Button>
      </div>
    </section>
  );
}
