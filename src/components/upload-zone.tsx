import { useState } from "react";

import { TrimDialog } from "#/components/trim-dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Progress } from "#/components/ui/progress";
import type { Asset, UploadedVideo } from "#/lib/contracts";
import { type Refusal, sendVideo } from "#/lib/requests";

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "probing" }
  | { kind: "too-long"; trimmed: Asset; video: UploadedVideo }
  | { kind: "rejected"; refusal: Refusal }
  | { assetId: string; kind: "ready" };

// Keyed by the API's runtime `reason` string.
const rejectionLabels = new Map([
  ["no_video", "No video"],
  ["too_large", "Too large"],
  ["too_short", "Too short"],
]);

function describe(state: UploadState, selectedAssetId: string | undefined) {
  switch (state.kind) {
    case "idle":
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
 * ready`. A clip of 3–8 s is ready as uploaded; a longer one opens the trim dialog.
 */
export function UploadZone({
  onReady,
  selectedAssetId,
}: {
  onReady: (assetId: string) => void;
  selectedAssetId: string | undefined;
}) {
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const busy = state.kind === "uploading" || state.kind === "probing";

  function ready(clip: Asset) {
    setState({ assetId: clip.id, kind: "ready" });
    onReady(clip.id);
  }

  async function upload(file: File) {
    setState({ kind: "uploading", percent: 0 });

    const result = await sendVideo(
      file,
      (percent) => setState({ kind: "uploading", percent }),
      () => setState({ kind: "probing" }),
    );

    if ("refusal" in result) {
      setState({ kind: "rejected", refusal: result.refusal });
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
          void upload(file);
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
            void upload(file);
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
      <p aria-live="polite" className="text-sm" data-state={state.kind} role="status">
        {describe(state, selectedAssetId)}
      </p>
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
