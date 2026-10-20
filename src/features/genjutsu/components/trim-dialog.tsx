import { InfoIcon, ScissorsIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
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
import { MAX_CLIP_MS, MIN_CLIP_MS, type UploadedVideo } from "#/features/genjutsu/contracts";
import { Hud, StatusDot, Viewfinder } from "#/shared/components/brand";
import { type Asset, assetSchema } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import { callApi } from "#/shared/requests";
import { duration, timecode } from "#/shared/timecode";
import { useRequestSignal } from "#/shared/use-request-signal";

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

/**
 * For a clip over 8 s: the whole clip with a window of 3–8 s on it, the chosen part playing on a
 * loop. Confirming the default (the first 8 s) uses the cut the upload already made; any other
 * range is cut by `POST /api/assets/:id/trim`. Every way of closing the dialog cancels a cut in
 * progress: the dialog unmounts, which aborts the request, and its result is dropped.
 */
export function TrimDialog({
  name,
  onCancel,
  onConfirm,
  trimmed,
  video,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: (clip: Asset) => void;
  trimmed: Asset;
  video: UploadedVideo;
}) {
  const length = video.duration_ms ?? MAX_CLIP_MS;
  const initial: Range = [0, Math.min(MAX_CLIP_MS, length)];
  const [range, setRange] = useState<Range>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextSignal = useRequestSignal();
  // State, not a ref: the dialog mounts its content in a portal after the first render, so the
  // effect has to run again once the element exists.
  const [preview, setPreview] = useState<HTMLVideoElement | null>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const [start, end] = range;
  const portrait = (video.height ?? 0) >= (video.width ?? 0);

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

  // The window over the timeline, from the range, as CSS variables (no inline styles).
  useEffect(() => {
    timeline.current?.style.setProperty("--from", `${(start / length) * 100}%`);
    timeline.current?.style.setProperty("--to", `${100 - (end / length) * 100}%`);
  }, [start, end, length]);

  async function confirm() {
    if (start === initial[0] && end === initial[1]) {
      onConfirm(trimmed);

      return;
    }

    const signal = nextSignal();

    setPending(true);
    setError(null);

    const result = await callApi(assetSchema, `/api/assets/${video.id}/trim`, {
      body: JSON.stringify({ duration_ms: end - start, start_ms: start }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    });

    if (signal.aborted) {
      return;
    }

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
      <DialogContent size="lg">
        <DialogHeader>
          <Hud>
            <span className="break-all">{name}</span> · {duration(length)}
          </Hud>
          <DialogTitle>Choose up to 8 seconds</DialogTitle>
          <DialogDescription>
            Your clip is longer than 8 seconds. Drag the handles to the part with the move; it loops
            in the preview.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-stretch">
          <div className="relative mx-auto w-44 shrink-0 overflow-hidden rounded-xl border bg-screen sm:mx-0 sm:w-55">
            <video
              aria-label="Preview of the chosen part"
              className={
                portrait
                  ? "aspect-9/16 w-full object-cover"
                  : "aspect-video w-full object-contain sm:h-full"
              }
              playsInline
              ref={setPreview}
              src={mediaUrl(video)}
            />
            <span className="absolute top-3 left-3">
              <Badge variant="solid">
                <StatusDot tone="brand" />
                Loop
              </Badge>
            </span>
            <span className="absolute inset-x-3 bottom-3 flex justify-between">
              <Hud tone="foreground">{timecode(start / 1000)}</Hud>
              <Hud tone="foreground">{duration(end - start)}</Hud>
            </span>
            <Viewfinder className="inset-3" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-sm font-semibold">Selection</span>
              <span className="font-mono text-sm" aria-hidden="true">
                {timecode(start / 1000)} → {timecode(end / 1000)}{" "}
                <span className="text-muted-foreground">· {duration(end - start)}</span>
              </span>
            </div>
            <div className="relative" ref={timeline}>
              <div
                aria-hidden="true"
                className="relative h-16 overflow-hidden rounded-xl border bg-field"
              >
                <span className="absolute inset-y-0 right-(--to) left-(--from) rounded-lg border-2 border-brand bg-brand/12 ring-4 ring-brand/18" />
              </div>
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2">
                <Slider
                  disabled={pending}
                  max={length}
                  min={0}
                  minStepsBetweenThumbs={MIN_CLIP_MS / STEP_MS}
                  onValueChange={(next) => setRange(constrain(next, range))}
                  step={STEP_MS}
                  thumbLabels={["Trim start", "Trim end"]}
                  value={range}
                />
              </div>
            </div>
            <div aria-hidden="true" className="flex justify-between">
              <Hud>{timecode(0)}</Hud>
              <Hud>{timecode(length / 2000)}</Hud>
              <Hud>{timecode(length / 1000)}</Hud>
            </div>
            <p className="flex items-start gap-3 rounded-xl border bg-foreground/3 px-4 py-3.5 text-sm text-soft-foreground">
              <InfoIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-brand" />
              Keep between 3 and 8 seconds. The first 8 seconds are ready to go; any other part is
              cut when you confirm.
            </p>
            {error && (
              <p className="text-sm text-destructive-foreground" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button disabled={pending} onClick={confirm}>
            <ScissorsIcon />
            {pending
              ? "Cutting…"
              : `Use these ${Number(((end - start) / 1000).toFixed(1))} seconds`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
