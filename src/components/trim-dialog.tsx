import { useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Slider } from "#/components/ui/slider";
import {
  type Asset,
  assetSchema,
  MAX_CLIP_MS,
  MIN_CLIP_MS,
  type UploadedVideo,
} from "#/lib/contracts";
import { mediaUrl } from "#/lib/media";
import { callApi } from "#/lib/requests";

const STEP_MS = 100;

type Range = [start: number, end: number];

/** Keeps a range within 8 s by moving the handle the user did not drag. */
function constrain(next: number[], previous: Range): Range {
  const [start = previous[0], end = previous[1]] = next;

  if (end - start <= MAX_CLIP_MS) {
    return [start, end];
  }

  return start === previous[0] ? [end - MAX_CLIP_MS, end] : [start, start + MAX_CLIP_MS];
}

function seconds(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

/**
 * For a clip over 8 s: the whole clip with a range of 3–8 s on it, the chosen range playing on
 * a loop. Confirming the default (the first 8 s) uses the cut the upload already made; any other
 * range is cut by `POST /api/assets/:id/trim`.
 */
export function TrimDialog({
  onCancel,
  onConfirm,
  trimmed,
  video,
}: {
  onCancel: () => void;
  onConfirm: (clip: Asset) => void;
  trimmed: Asset;
  video: UploadedVideo;
}) {
  const duration = video.duration_ms ?? MAX_CLIP_MS;
  const initial: Range = [0, Math.min(MAX_CLIP_MS, duration)];
  const [range, setRange] = useState<Range>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State, not a ref: the dialog mounts its content in a portal after the first render, so the
  // effect has to run again once the element exists.
  const [preview, setPreview] = useState<HTMLVideoElement | null>(null);
  const [start, end] = range;

  useEffect(() => {
    if (!preview) {
      return;
    }

    const loop = () => {
      if (preview.currentTime * 1000 >= end || preview.currentTime * 1000 < start) {
        preview.currentTime = start / 1000;
      }
    };

    preview.muted = true;
    preview.currentTime = start / 1000;
    preview.addEventListener("timeupdate", loop);
    preview.play().catch(() => {
      // Autoplay refused: the preview shows the range's first frame instead.
    });

    return () => preview.removeEventListener("timeupdate", loop);
  }, [preview, start, end]);

  async function confirm() {
    if (start === initial[0] && end === initial[1]) {
      onConfirm(trimmed);

      return;
    }

    setPending(true);
    setError(null);

    const result = await callApi(assetSchema, `/api/assets/${video.id}/trim`, {
      body: JSON.stringify({ duration_ms: end - start, start_ms: start }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    setPending(false);

    if ("refusal" in result) {
      setError(result.refusal.message);
    } else {
      onConfirm(result.data);
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      open
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trim your clip</DialogTitle>
          <DialogDescription>
            This clip is {seconds(duration)} long. A motion lasts 3 to 8 seconds: drag the handles
            to choose the part to use. The preview plays that part.
          </DialogDescription>
        </DialogHeader>
        <video
          aria-label="Preview of the chosen part"
          className="max-h-80 w-full rounded-md bg-muted object-contain"
          playsInline
          ref={setPreview}
          src={mediaUrl(video)}
        />
        <Slider
          aria-label="Part of the clip to use"
          max={duration}
          min={0}
          minStepsBetweenThumbs={MIN_CLIP_MS / STEP_MS}
          onValueChange={(next) => setRange(constrain(next, range))}
          step={STEP_MS}
          value={range}
        />
        <p className="text-sm text-muted-foreground">
          {seconds(start)} to {seconds(end)} ({seconds(end - start)})
        </p>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button disabled={pending} onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button disabled={pending} onClick={confirm}>
            {pending ? "Cutting…" : "Use this part"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
