import { cn } from "cn";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  IdleUpload,
  RejectedState,
  uploadTileClass,
  WorkingState,
} from "#/features/motionTransfer/components/upload-states";
import { characterSchema } from "#/features/motionTransfer/contracts";
import { callApi, type Refusal } from "#/shared/requests";
import type { HoldForCode } from "#/shared/use-access-code";
import { useRequestSignal } from "#/shared/use-request-signal";

// The key the waiting photo is held under (`useAccessCode`).
const HELD = "photo-upload";

type PhotoState =
  | { kind: "idle" }
  // A photo is picked and shown; it is uploaded once its likeness consent is ticked and confirmed.
  | { file: File; kind: "picked" }
  | { file: File; kind: "uploading" }
  // With the character chosen when it came: choosing another one clears it.
  | { kind: "rejected"; refusal: Refusal; selectedId: string | undefined };

/** A local preview of the picked file, revoked when it changes or the tile goes. */
function usePreview(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);

      return;
    }

    const next = URL.createObjectURL(file);

    setUrl(next);

    return () => URL.revokeObjectURL(next);
  }, [file]);

  return url;
}

/**
 * The first item of the character grid (an `<li>`, two columns wide while it asks for consent):
 * upload a photo of a person. Picking a file shows it with
 * the likeness-consent checkbox right under it, and one confirm ("Use photo") uploads it; "Pick
 * another" chooses again. A refusal (`not_image`, a limit) shows in the tile until another
 * character is chosen. Without an access session (`signedIn`, or a 401 when it has expired)
 * the photo is held for the code (`hold`) and uploads as soon as the visitor signs in, by this
 * dialog or any other way; picking another photo, or leaving the step, lets it go (`release`).
 */
export function CharacterUpload({
  hold,
  onReady,
  release,
  selectedId,
  signedIn,
}: {
  hold: HoldForCode;
  onReady: (characterId: string) => void;
  release: (key: string) => void;
  selectedId: string | undefined;
  signedIn: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<PhotoState>({ kind: "idle" });
  const [consent, setConsent] = useState(false);
  const nextSignal = useRequestSignal();
  const file = state.kind === "picked" || state.kind === "uploading" ? state.file : null;
  const preview = usePreview(file);

  // A photo left waiting for the code is not uploaded once the step is gone.
  useEffect(() => () => release(HELD), [release]);

  const shown: PhotoState =
    state.kind === "rejected" && state.selectedId !== selectedId ? { kind: "idle" } : state;

  async function send(photo: File) {
    const signal = nextSignal();
    const form = new FormData();

    form.append("consent", "true");
    form.append("image", photo);
    setState({ file: photo, kind: "uploading" });

    const result = await callApi(characterSchema, "/api/characters", {
      body: form,
      method: "POST",
      signal,
    });

    // The page moved on (unmounted): the upload was cancelled, and nothing is selected.
    if (signal.aborted) {
      return;
    }

    if ("refusal" in result) {
      if (result.refusal.reason === "access_required") {
        setState({ file: photo, kind: "picked" });
        hold(HELD, "upload", () => void send(photo), { waits: true });
      } else {
        setState({ kind: "rejected", refusal: result.refusal, selectedId });
      }
    } else {
      setState({ kind: "idle" });
      setConsent(false);
      onReady(result.data.id);
    }
  }

  function confirm(photo: File) {
    if (signedIn) {
      void send(photo);
    } else {
      hold(HELD, "upload", () => void send(photo), { waits: true });
    }
  }

  return (
    <li className={cn("relative", shown.kind === "picked" && "col-span-2")}>
      <input
        accept="image/png,image/jpeg,image/webp"
        aria-describedby={`${id}-rules`}
        aria-label="Upload a photo"
        className="peer sr-only"
        disabled={state.kind === "uploading"}
        id={id}
        onChange={(event) => {
          const picked = event.target.files?.[0];

          event.target.value = "";

          if (picked) {
            release(HELD);
            setConsent(false);
            setState({ file: picked, kind: "picked" });
          }
        }}
        ref={input}
        type="file"
      />
      <span className="sr-only" id={`${id}-rules`}>
        PNG, JPEG or WebP, one person, clearly lit. You confirm that you may use their likeness
        before it uploads.{signedIn ? "" : " Uploads need an access code."}
      </span>

      {shown.kind === "picked" ? (
        <div
          className="grid h-full min-h-56 grid-cols-5 gap-4 rounded-xl border border-brand/50 bg-card p-3.5"
          data-upload-state="picked"
        >
          <div className="relative col-span-2 overflow-hidden rounded-lg bg-screen">
            {preview && (
              <img
                alt="The photo you picked"
                className="absolute inset-0 size-full object-cover"
                src={preview}
              />
            )}
          </div>
          <div className="col-span-3 flex flex-col justify-center gap-3 py-2">
            <span className="font-semibold">Use this photo?</span>
            <div className="flex items-start gap-3">
              <Checkbox
                checked={consent}
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
            <div className="flex flex-wrap gap-1">
              <Button disabled={!consent} onClick={() => confirm(shown.file)} size="sm">
                Use photo
              </Button>
              <Button onClick={() => input.current?.click()} size="sm" variant="ghost">
                Pick another
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            uploadTileClass(
              shown.kind === "idle" ? "idle" : shown.kind === "rejected" ? "danger" : "busy",
            ),
            shown.kind === "idle" &&
              "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ring",
          )}
          data-reason={shown.kind === "rejected" ? shown.refusal.reason : undefined}
          data-upload-state={shown.kind}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();

            const dropped = event.dataTransfer.files[0];

            if (dropped && state.kind !== "uploading") {
              release(HELD);
              setConsent(false);
              setState({ file: dropped, kind: "picked" });
            }
          }}
        >
          {shown.kind === "idle" && (
            <IdleUpload htmlFor={id} signedIn={signedIn} title="Upload a photo">
              <span aria-hidden="true" className="text-sm text-muted-foreground">
                Drop it here or browse
                <br />
                PNG, JPEG or WebP
              </span>
            </IdleUpload>
          )}

          {shown.kind === "uploading" && (
            <WorkingState text="Checking that it is an image" title="Uploading photo" />
          )}

          {shown.kind === "rejected" && (
            <RejectedState onTryAnother={() => input.current?.click()} refusal={shown.refusal} />
          )}

          <span aria-live="polite" className="sr-only" role="status">
            {shown.kind === "uploading" ? "Uploading the photo." : ""}
          </span>
        </div>
      )}
    </li>
  );
}
