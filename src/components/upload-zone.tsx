import { useState } from "react";

import { AccessCodeForm } from "#/components/access-code-form";
import { TrimDialog } from "#/components/trim-dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Progress } from "#/components/ui/progress";
import type { Asset, UploadedVideo } from "#/lib/contracts";
import { type Refusal, sendVideo } from "#/lib/requests";
import { useRequestSignal } from "#/lib/use-request-signal";

type UploadState =
  | { kind: "idle" }
  // An upload needs an access code: the file waits for it.
  | { file: File; kind: "needs-code" }
  | { kind: "uploading"; percent: number }
  | { kind: "probing" }
  | { kind: "too-long"; trimmed: Asset; video: UploadedVideo }
  // `selectedAssetId`: the motion chosen when the clip was refused. Choosing another one (a
  // sample, or another entry in the history) clears the refusal.
  | { kind: "rejected"; refusal: Refusal; selectedAssetId: string | undefined }
  | { assetId: string; kind: "ready" };

// Keyed by the API's runtime `reason` string.
const rejectionLabels = new Map([
  ["no_video", "No video"],
  ["rate_limited", "Slow down"],
  ["too_large", "Too large"],
  ["too_short", "Too short"],
]);

function describe(state: UploadState, selectedAssetId: string | undefined) {
  switch (state.kind) {
    case "idle":
    case "needs-code":
      return "";
    case "uploading":
      return `Uploading ${state.percent}%`;
    case "probing":
      return "Checking the clip…";
    case "too-long":
      return "Too long: choose up to 8 seconds of it.";
    case "rejected":
      return `${rejectionLabels.get(state.refusal.reason ?? "") ?? "Rejected"}: ${state.refusal.message}`;
    case "ready":
      return state.assetId === selectedAssetId ? "Ready" : "";
  }
}

/**
 * Upload your own driving clip: `uploading % → probing → too long (trim) | rejected (reason) →
 * ready`. A clip of 3–8 s is ready as uploaded; a longer one opens the trim dialog. Without an
 * access session (`signedIn`, or a 401 when it has expired) the code comes first, inline, and the
 * chosen file is uploaded right after it.
 */
export function UploadZone({
  onReady,
  selectedAssetId,
  signedIn,
}: {
  onReady: (assetId: string) => void;
  selectedAssetId: string | undefined;
  signedIn: boolean;
}) {
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const nextSignal = useRequestSignal();
  const busy = state.kind === "uploading" || state.kind === "probing";

  const shown: UploadState =
    state.kind === "rejected" && state.selectedAssetId !== selectedAssetId
      ? { kind: "idle" }
      : state;

  function ready(clip: Asset) {
    setState({ assetId: clip.id, kind: "ready" });
    onReady(clip.id);
  }

  function upload(file: File) {
    if (signedIn) {
      void send(file);
    } else {
      setState({ file, kind: "needs-code" });
    }
  }

  async function send(file: File) {
    const signal = nextSignal();

    setState({ kind: "uploading", percent: 0 });

    const result = await sendVideo(file, {
      onProgress: (percent) => setState({ kind: "uploading", percent }),
      onSent: () => setState({ kind: "probing" }),
      signal,
    });

    // The page moved on (unmounted): the upload was cancelled, and nothing is selected.
    if (signal.aborted) {
      return;
    }

    if ("refusal" in result) {
      setState(
        result.refusal.reason === "access_required"
          ? { file, kind: "needs-code" }
          : { kind: "rejected", refusal: result.refusal, selectedAssetId },
      );
    } else if (result.video.trimmed) {
      setState({ kind: "too-long", trimmed: result.video.trimmed, video: result.video });
    } else {
      ready(result.video);
    }
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-dashed p-4"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();

        const file = event.dataTransfer.files[0];

        if (file && !busy) {
          upload(file);
        }
      }}
    >
      <Label htmlFor="motion-file">Or upload your own clip (drop it here)</Label>
      <Input
        accept="video/mp4,video/quicktime,video/webm"
        disabled={busy}
        id="motion-file"
        onChange={(event) => {
          const file = event.target.files?.[0];

          // Cleared so that choosing the same file again uploads it again.
          event.target.value = "";

          if (file) {
            upload(file);
          }
        }}
        type="file"
      />
      <p className="text-sm text-muted-foreground">
        One person, full body, steady framing. 3 to 8 seconds; a longer clip is trimmed.
      </p>
      {state.kind === "uploading" && (
        <Progress aria-label="Upload progress" value={state.percent} />
      )}
      <p
        aria-live="polite"
        className="text-sm"
        data-reason={shown.kind === "rejected" ? shown.refusal.reason : undefined}
        data-state={shown.kind}
        role="status"
      >
        {describe(shown, selectedAssetId)}
      </p>
      {state.kind === "needs-code" && <AccessCodeForm onSignedIn={() => void send(state.file)} />}
      {state.kind === "too-long" && (
        <TrimDialog
          onCancel={() => setState({ kind: "idle" })}
          onConfirm={ready}
          trimmed={state.trimmed}
          video={state.video}
        />
      )}
    </div>
  );
}
