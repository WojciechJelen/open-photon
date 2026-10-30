import { cn } from "cn";
import { LockIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import { TrimDialog } from "#/features/motionTransfer/components/trim-dialog";
import {
  IdleUpload,
  RejectedState,
  StateIcon,
  uploadTileClass,
  WorkingState,
} from "#/features/motionTransfer/components/upload-states";
import type { UploadedVideo } from "#/features/motionTransfer/contracts";
import { sendVideo } from "#/features/motionTransfer/send-video";
import type { Asset } from "#/shared/contracts";
import type { Refusal } from "#/shared/requests";
import type { HoldForCode } from "#/shared/use-access-code";
import { useRequestSignal } from "#/shared/use-request-signal";

// The key the waiting file is held under (`useAccessCode`).
const HELD = "motion-upload";

type UploadState =
  | { kind: "idle" }
  // An upload needs an access code: the file waits for it.
  | { file: File; kind: "needs-code" }
  | { kind: "uploading"; name: string; percent: number }
  | { kind: "probing"; name: string }
  | { kind: "too-long"; name: string; trimmed: Asset; video: UploadedVideo }
  // `selectedAssetId`: the motion chosen when the clip was refused. Choosing another one (a
  // sample, or another entry in the history) clears the refusal.
  | { kind: "rejected"; refusal: Refusal; selectedAssetId: string | undefined };

/** What the tile's polite live region says for each state; a refusal is an alert of its own. */
function announcement(state: UploadState) {
  switch (state.kind) {
    case "idle":
    case "rejected":
      return "";
    case "needs-code":
      return `${state.file.name} is waiting for the access code.`;
    case "uploading":
      return `Uploading ${state.name}.`;
    case "probing":
      return "Checking the clip.";
    case "too-long":
      return "The clip is over 8 seconds: choose the part to use.";
  }
}

/**
 * The last tile of the motion row: upload your own driving clip, by drop or by browsing. It walks
 * through its states in place, in the box of the idle tile: idle (with `children`, the advice on a
 * good clip), waiting for the access code, uploading %, checking (the server probes it), rejected
 * with the reason, or over 8 s, which opens the trim dialog. A 3–8 s clip is ready as uploaded and
 * `onReady` picks it. Without an access session (`signedIn`, or a 401 when it has expired) the file
 * waits in the tile and is held for the code (`hold`): it uploads as soon as the visitor signs in,
 * by this dialog or any other way. Cancelling it, or leaving the step, lets it go (`release`).
 */
export function MotionUpload({
  children,
  hold,
  onReady,
  release,
  selectedAssetId,
  signedIn,
}: {
  children: React.ReactNode;
  hold: HoldForCode;
  onReady: (assetId: string) => void;
  release: (key: string) => void;
  selectedAssetId: string | undefined;
  signedIn: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const nextSignal = useRequestSignal();
  const busy = state.kind === "uploading" || state.kind === "probing";

  // A file left waiting for the code is not uploaded once the step is gone.
  useEffect(() => () => release(HELD), [release]);

  const shown: UploadState =
    state.kind === "rejected" && state.selectedAssetId !== selectedAssetId
      ? { kind: "idle" }
      : state;

  function ready(clip: Asset) {
    setState({ kind: "idle" });
    onReady(clip.id);
  }

  function waitForCode(file: File) {
    setState({ file, kind: "needs-code" });
    hold(HELD, "upload", () => void send(file), { waits: true });
  }

  function upload(file: File) {
    if (signedIn) {
      void send(file);
    } else {
      waitForCode(file);
    }
  }

  async function send(file: File) {
    const signal = nextSignal();

    setState({ kind: "uploading", name: file.name, percent: 0 });

    const result = await sendVideo(file, {
      onProgress: (percent) => setState({ kind: "uploading", name: file.name, percent }),
      onSent: () => setState({ kind: "probing", name: file.name }),
      signal,
    });

    // Cancelled, or the page moved on (unmounted): nothing is selected.
    if (signal.aborted) {
      return;
    }

    if ("refusal" in result) {
      if (result.refusal.reason === "access_required") {
        waitForCode(file);
      } else {
        setState({ kind: "rejected", refusal: result.refusal, selectedAssetId });
      }
    } else if (result.video.trimmed) {
      setState({
        kind: "too-long",
        name: file.name,
        trimmed: result.video.trimmed,
        video: result.video,
      });
    } else {
      ready(result.video);
    }
  }

  function cancel() {
    // A new signal aborts the upload in flight; nothing uses it.
    nextSignal();
    release(HELD);
    setState({ kind: "idle" });
  }

  return (
    <div
      className={cn(
        "h-full min-h-95",
        uploadTileClass(
          shown.kind === "idle"
            ? "idle"
            : shown.kind === "needs-code"
              ? "warning"
              : shown.kind === "rejected"
                ? "danger"
                : "busy",
        ),
        shown.kind === "idle" &&
          "has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-ring",
      )}
      data-reason={shown.kind === "rejected" ? shown.refusal.reason : undefined}
      data-upload-state={shown.kind}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();

        const file = event.dataTransfer.files[0];

        if (file && !busy) {
          upload(file);
        }
      }}
    >
      <input
        accept="video/mp4,video/quicktime,video/webm"
        aria-describedby={`${id}-rules`}
        aria-label="Upload a clip"
        className="sr-only"
        disabled={busy}
        id={id}
        onChange={(event) => {
          const file = event.target.files?.[0];

          // Cleared so that choosing the same file again uploads it again.
          event.target.value = "";

          if (file) {
            upload(file);
          }
        }}
        ref={input}
        type="file"
      />
      <span className="sr-only" id={`${id}-rules`}>
        MP4, MOV or WebM, up to 128 MB. One person, whole body in frame, 3 to 8 seconds; a longer
        clip opens a trimmer.{signedIn ? "" : " Uploads need an access code."}
      </span>

      {shown.kind === "idle" && (
        <IdleUpload
          choose="Choose a clip"
          hint="MP4, MOV or WebM, up to 128 MB"
          htmlFor={id}
          signedIn={signedIn}
          title="Drop your own clip"
        >
          {children}
        </IdleUpload>
      )}

      {shown.kind === "needs-code" && (
        <>
          <StateIcon tone="warning">
            <LockIcon className="size-5" strokeWidth={1.75} />
          </StateIcon>
          <span className="flex w-full min-w-0 flex-col gap-0.5">
            <span className="truncate text-base font-semibold" title={shown.file.name}>
              {shown.file.name} is waiting
            </span>
            <span className="type-caption text-soft-foreground">
              Enter the access code and it uploads right away.
            </span>
          </span>
          <div className="flex flex-wrap justify-center gap-1">
            {/* Signed in meanwhile, it uploads; otherwise it asks for the code again. */}
            <Button onClick={() => upload(shown.file)} size="sm">
              {signedIn ? "Upload" : "Enter code"}
            </Button>
            <Button onClick={cancel} size="sm" variant="ghost">
              Cancel
            </Button>
          </div>
        </>
      )}

      {shown.kind === "uploading" && (
        <>
          <span aria-hidden="true" className="font-mono text-3xl font-medium tabular-nums">
            {shown.percent}%
          </span>
          <div className="w-full max-w-60">
            <Progress aria-label="Upload progress" value={shown.percent} />
          </div>
          <span className="w-full truncate type-caption text-soft-foreground" title={shown.name}>
            Uploading {shown.name}
          </span>
          <Button onClick={cancel} size="sm" variant="ghost">
            Cancel
          </Button>
        </>
      )}

      {(shown.kind === "probing" || shown.kind === "too-long") && (
        <WorkingState text="Reading its length, frames and sound" title="Checking the clip" />
      )}

      {shown.kind === "rejected" && (
        <RejectedState onTryAnother={() => input.current?.click()} refusal={shown.refusal} />
      )}

      <span aria-live="polite" className="sr-only" role="status">
        {announcement(shown)}
      </span>

      {state.kind === "too-long" && (
        <TrimDialog
          name={state.name}
          onCancel={() => setState({ kind: "idle" })}
          onConfirm={ready}
          trimmed={state.trimmed}
          video={state.video}
        />
      )}
    </div>
  );
}
