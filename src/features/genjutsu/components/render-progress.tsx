import { cn } from "cn";
import { CheckIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";

import { Progress } from "#/components/ui/progress";
import type { GenerationSnapshot } from "#/features/genjutsu/contracts";
import { Hud } from "#/shared/components/brand";
import { CopyField } from "#/shared/components/copy-field";

const stages = [
  {
    active: "Sending the clip and photo to Comfy",
    done: "Clip and photo sent to Comfy",
    status: "preparing",
    title: "Preparing",
  },
  {
    active: "Waiting for a free GPU",
    done: "A GPU took the job",
    status: "queued",
    title: "Queued",
  },
  {
    active: "Your character performs the move, frame by frame",
    done: "Every frame rendered",
    status: "running",
    title: "Rendering",
  },
  {
    active: "Saving the video and its poster",
    done: "Saved",
    status: "finalizing",
    title: "Finishing",
  },
];

/** The stage a status is in, by its index in `stages` (a done generation is past all of them). */
function stageIndex(status: GenerationSnapshot["status"]) {
  const index = stages.findIndex((stage) => stage.status === status);

  return index === -1 ? stages.length : index;
}

/** The title of the stage a generation is in, for its status line. */
export function stageTitle(status: GenerationSnapshot["status"]) {
  return stages[stageIndex(status)]?.title ?? "Finishing";
}

/**
 * Step 4 while it renders: the named stages, `preparing → queued → running → finalizing`, the
 * current one with the real progress Comfy reports (never a time estimate, which Comfy does not
 * give; Comfy may skip `running` and go straight to finishing), a notice while Comfy cannot be
 * asked, and the link back to this page. The render goes on on Comfy whether or not the page is
 * open: the page's stream (or the next visit) collects it, so leaving is safe.
 */
export function RenderProgress({
  generation,
  pageUrl,
  providerUnavailable,
}: {
  generation: GenerationSnapshot;
  pageUrl: string;
  providerUnavailable: boolean;
}) {
  const current = stageIndex(generation.status);
  const percent = generation.progress ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <ol
        aria-label="Render stages"
        className="rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 px-5 py-2"
      >
        {stages.map((stage, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";

          return (
            <li
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-3.5 border-t py-3.5 first:border-t-0",
                state === "todo" && "text-muted-foreground",
              )}
              key={stage.status}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border border-input font-mono text-xs",
                  state === "done" && "border-brand/50 bg-brand/16 text-brand",
                  state === "current" &&
                    "border-transparent bg-linear-100 from-brand via-brand-mid to-brand-2 font-semibold text-primary-foreground",
                )}
              >
                {state === "done" ? <CheckIcon className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-2.5">
                <span className="flex flex-col">
                  <b className={state === "todo" ? "text-soft-foreground" : undefined}>
                    {stage.title}
                  </b>
                  <span className="text-sm text-soft-foreground">
                    {state === "done" ? stage.done : stage.active}
                  </span>
                </span>
                {state === "current" && stage.status === "running" && (
                  <Progress aria-label="Render progress" value={percent} />
                )}
              </span>
              <Hud tone={state === "current" ? "foreground" : "muted"}>
                {state === "done"
                  ? "Done"
                  : state === "current"
                    ? stage.status === "running"
                      ? `${percent}%`
                      : "Now"
                    : index === current + 1
                      ? "Next"
                      : ""}
              </Hud>
            </li>
          );
        })}
      </ol>

      {providerUnavailable && (
        <p
          aria-label="Comfy connection"
          className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/5 px-5 py-4 text-sm text-soft-foreground"
          role="status"
        >
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-warning" />
          Comfy can't be reached right now, so this is the last known status. The page keeps trying
          on its own.
        </p>
      )}

      <div className="flex flex-col gap-3.5 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="flex flex-col gap-0.5">
            <b>Safe to leave</b>
            <span className="text-sm text-soft-foreground">
              The render keeps going on Comfy. This link brings you back to it.
            </span>
          </div>
        </div>
        <CopyField copyLabel="Copy link" hideLabel label="Link to this render" value={pageUrl} />
      </div>
    </div>
  );
}
