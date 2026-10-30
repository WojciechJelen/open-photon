import { cn } from "cn";
import { CheckIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";

import { Progress } from "#/components/ui/progress";
import { StatusDot } from "#/shared/components/brand";
import { CopyField } from "#/shared/components/copy-field";
import { Panel } from "#/shared/components/panel";
import type { GenerationSnapshot } from "#/shared/contracts";
import { isFinished } from "#/shared/use-live-generation";

/** What each status of a take on its way is called, in its status line and on the stage. */
const statusTitles: Partial<Record<GenerationSnapshot["status"], string>> = {
  finalizing: "Finishing",
  preparing: "Preparing",
  queued: "Queued",
  running: "Rendering",
  waiting: "In line",
};

/** The title of the stage a generation is in, for its status line (`In line · #2`). */
export function stageTitle(generation: Pick<GenerationSnapshot, "position" | "status">) {
  const title = statusTitles[generation.status] ?? "Finishing";

  return generation.status === "waiting" && generation.position !== null
    ? `${title} · #${generation.position}`
    : title;
}

/** The three steps a visitor follows; the statuses of the first are told on the stage. */
const phases = ["Getting ready", "Rendering", "Finishing"];

/**
 * The phase a generation is in, by its index in `phases`. One that ended without a video is where
 * it stopped, as far as its row tells: at the save, past a first frame, or before one.
 */
function phaseOf({ error_code, progress, status }: GenerationSnapshot) {
  if (status === "running") {
    return 1;
  }

  if (status === "finalizing" || error_code === "finalize_failed") {
    return 2;
  }

  return isFinished(status) && (progress ?? 0) > 0 ? 1 : 0;
}

/**
 * The render's bar and its three phases: the real progress Comfy reports (never a time estimate,
 * which Comfy does not give; Comfy may skip `running` and go straight to finishing, which is past
 * every frame). A take that ended keeps the bar where it stopped, stilled. Each phase keeps the
 * room for its mark and its semibold width, so a phase passing moves none of them.
 */
export function RenderTrack({ generation }: { generation: GenerationSnapshot }) {
  const phase = phaseOf(generation);
  const stopped = isFinished(generation.status);
  const percent = generation.status === "finalizing" ? 100 : (generation.progress ?? 0);

  return (
    <Panel className="gap-3.5 p-5">
      <div className={cn(stopped && "grayscale **:after:animate-none")}>
        <Progress aria-label="Render progress" value={percent} />
      </div>
      <ol aria-label="Render stages" className="flex justify-between gap-2">
        {phases.map((title, index) => {
          const current = index === phase;
          const live = current && !stopped;

          return (
            <li
              aria-current={live ? "step" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-1.5 type-caption font-medium whitespace-nowrap",
                live ? "font-semibold text-foreground" : "text-muted-foreground",
                index < phase && "text-soft-foreground",
              )}
              key={title}
            >
              <span aria-hidden="true" className="grid size-3.5 shrink-0 place-items-center">
                {index < phase && <CheckIcon className="size-3.5 text-brand-foreground" />}
                {live && <StatusDot tone="brand" />}
                {current && stopped && <TriangleAlertIcon className="size-3.5 text-warning" />}
              </span>
              <span
                className="reserve-semibold min-w-0 grid-cols-1 overflow-hidden"
                data-label={title}
              >
                <span className="min-w-0 truncate">{title}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/**
 * Step 4 while it renders: `RenderTrack`, and the link back to this page. The render goes on on
 * the server and Comfy whether or not the page is open: the server's dispatcher sends it once a
 * slot opens and collects it, so leaving is safe. While Comfy cannot be asked, a notice takes the
 * place of that reassurance: they share a cell, so the card keeps its height either way.
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
  return (
    <>
      <RenderTrack generation={generation} />
      <Panel className="gap-3.5 p-5">
        <div className="grid grid-cols-1">
          <div
            className={cn(
              "col-start-1 row-start-1 flex items-start gap-3",
              providerUnavailable && "invisible",
            )}
          >
            <ShieldCheckIcon
              aria-hidden="true"
              className="mt-0.5 size-4.5 shrink-0 text-success"
              strokeWidth={1.75}
            />
            <div className="flex min-w-0 flex-col wrap-anywhere">
              <span className="font-semibold">Safe to leave</span>
              <span className="text-sm text-soft-foreground">
                This link brings you back to your take.
              </span>
            </div>
          </div>
          <div
            aria-label="Comfy connection"
            className={cn(
              "col-start-1 row-start-1 flex items-start gap-3",
              !providerUnavailable && "invisible",
            )}
            role="status"
          >
            <TriangleAlertIcon
              aria-hidden="true"
              className="mt-0.5 size-4.5 shrink-0 text-warning"
              strokeWidth={1.75}
            />
            <div className="flex min-w-0 flex-col wrap-anywhere">
              <span className="font-semibold">Comfy can't be reached right now</span>
              <span className="text-sm text-soft-foreground">
                This is the last known status. The page keeps trying.
              </span>
            </div>
          </div>
        </div>
        <CopyField copyLabel="Copy" hideLabel label="Link to this take" value={pageUrl} />
      </Panel>
    </>
  );
}
