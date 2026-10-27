import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { TriangleAlertIcon } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

import {
  MotionTransferHeader,
  type HeaderStep,
} from "#/features/motionTransfer/components/motion-transfer-header";
import {
  type ChildState,
  endingTitle,
  RenderEnded,
} from "#/features/motionTransfer/components/render-ended";
import { RenderProgress, stageTitle } from "#/features/motionTransfer/components/render-progress";
import { ResultView } from "#/features/motionTransfer/components/result-view";
import {
  directionFields,
  type MotionTransferDraft,
  snapshotDraft,
} from "#/features/motionTransfer/draft";
import { loadResult } from "#/features/motionTransfer/generate.functions";
import type { ResultGenerationActionsProps } from "#/features/motionTransfer/slots";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow, StatusDot, Viewfinder } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";
import {
  GeneratedOutputs,
  generatedTitle,
  shownOutputs,
} from "#/shared/components/generated-outputs";
import { OpenWeightsBadge, SiteHeader } from "#/shared/components/site";
import { generationReceiptSchema, type GenerationSnapshot } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import { callApi } from "#/shared/requests";
import { duration } from "#/shared/timecode";
import { useAccessCode } from "#/shared/use-access-code";
import { isFinished, useLiveGeneration } from "#/shared/use-live-generation";
import { useRequestSignal } from "#/shared/use-request-signal";

type Result = NonNullable<Awaited<ReturnType<typeof loadResult>>>;

type MotionTransferResult = Extract<Result, { view: "motionTransfer" }>;

type OutputsResult = Extract<Result, { view: "outputs" }>;

/**
 * The monitor of a take that is not a video yet: the character (or the clip) blurred behind the
 * live percent while it renders, under a scan line; where it stopped when it failed; the amber
 * question mark of an unknown one.
 */
function RenderMonitor({
  background,
  generation,
  portrait,
  size,
  target,
}: {
  background: React.ReactNode;
  generation: GenerationSnapshot;
  portrait: boolean;
  size: string;
  target: string;
}) {
  const running = !isFinished(generation.status);
  const cancelled = generation.status === "cancelled";
  const failed = generation.status === "failed" || cancelled;

  return (
    <div className="mx-auto flex w-full max-w-52 shrink-0 flex-col gap-3 sm:max-w-72 lg:mx-0 lg:max-w-105">
      <div aria-hidden="true" className="flex items-center justify-between gap-3">
        <Hud className="inline-flex items-center gap-2" tone={running ? "foreground" : "soft"}>
          <StatusDot tone={running ? "tally" : failed ? "danger" : "warning"} />
          {running
            ? generation.status === "waiting"
              ? "In line"
              : "Rendering"
            : failed
              ? "Stopped"
              : "Unknown"}
        </Hud>
        <Hud>{size}</Hud>
      </div>
      <div
        className={cn(
          "relative overflow-hidden rounded-3xl border bg-screen",
          portrait ? "aspect-9/16" : "aspect-video",
          running && "shadow-monitor",
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 scale-115 blur-xl",
            running ? "opacity-45 saturate-70" : "opacity-30 grayscale",
          )}
        >
          {background}
        </div>
        {running && (
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-linear-to-b from-transparent via-brand/16 to-transparent motion-safe:animate-scan motion-reduce:hidden"
          />
        )}
        <div
          aria-hidden="true"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
        >
          {running ? (
            <>
              <span className="font-display text-6xl leading-none font-bold tracking-display sm:text-8xl">
                {generation.progress ?? 0}
                <span className="text-3xl text-soft-foreground sm:text-4xl">%</span>
              </span>
              <Hud tone="foreground">{stageTitle(generation)}</Hud>
            </>
          ) : (
            <>
              <span
                className={cn(
                  "grid size-16 place-items-center rounded-full border",
                  failed
                    ? "border-destructive/40 bg-destructive/12 text-destructive-foreground"
                    : "border-warning/40 bg-warning/12 text-warning-foreground",
                )}
              >
                <TriangleAlertIcon className="size-7" />
              </span>
              <Hud tone="foreground">
                {cancelled
                  ? "Cancelled"
                  : failed
                    ? generation.progress
                      ? `Stopped at ${generation.progress}%`
                      : "Stopped"
                    : "Status unknown"}
              </Hud>
            </>
          )}
        </div>
        <div
          aria-hidden="true"
          className="absolute inset-x-3.5 bottom-3.5 hidden items-center justify-between gap-2 sm:flex"
        >
          <Hud tone="foreground">Wan Animate 2</Hud>
          <Hud tone="foreground">{target}</Hud>
        </div>
        <Viewfinder tone={running ? "brand" : failed ? "danger" : "dim"} />
      </div>
    </div>
  );
}

// How long the page waits before it loads a finished take's result again.
const RELOAD_MS = 2000;

/**
 * What a take the stream reports done shows (`select`, from the page's data): `initial` when the
 * page was loaded done; otherwise it is loaded (`loadResult`), and again every `RELOAD_MS` until
 * the stored row has it (the stream can say done before the commit is visible, and a load can
 * fail) or the page goes, so it never stays on "Finishing".
 */
function useWhenDone<Shown>(
  id: string,
  done: boolean,
  initial: Shown | null,
  select: (result: Result | null) => Shown | null,
) {
  const [loaded, setLoaded] = useState<Shown | null>(null);
  const shown = initial ?? loaded;

  useEffect(() => {
    if (!done || shown) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const attempt = async () => {
      const result = select(await loadResult({ data: id }).catch(() => null));

      if (stopped) {
        return;
      }

      if (result) {
        setLoaded(result);
      } else {
        timer = setTimeout(() => void attempt(), RELOAD_MS);
      }
    };

    void attempt();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [done, shown, id, select]);

  return shown;
}

/** The result, poster and side-by-side of a Motion Transfer take, as `loadResult` reads them. */
function resultAssets(result: Result | null) {
  return result?.view === "motionTransfer" && result.final
    ? { compare: result.compare, final: result.final, poster: result.poster }
    : null;
}

/**
 * `/g/:id` of a generation of a workflow other than Motion Transfer, by the media of its outputs:
 * its status as its event stream reports it and, once done, each image and each video output with
 * its poster (`GeneratedOutputs`), labelled AI-generated, with Download. A done snapshot lists its
 * outputs (`generationSchema`), stored with its status in one write, so done is final here: a
 * generation whose outputs are all text (a caption) shows that it has no file to show, never the
 * text.
 */
function OutputsView({ data }: { data: OutputsResult }) {
  const live = useLiveGeneration(data.generation);
  const { status } = live.generation;

  const outputs = live.generation.outputs.flatMap((output) =>
    output.media === "text" ? [] : [output],
  );

  const { category, media } = shownOutputs(outputs);

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category={category}>
        <span className="hidden sm:inline-flex">
          <OpenWeightsBadge />
        </span>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-150 flex-col gap-6 px-4 pt-10 pb-18 sm:px-8">
        <p
          aria-label="Generation status"
          className="inline-flex items-center gap-2 hud text-muted-foreground"
          data-status={status}
          role="status"
        >
          <StatusDot tone={status === "done" ? "ok" : isFinished(status) ? "danger" : "tally"} />
          {status === "done"
            ? "Done"
            : isFinished(status)
              ? endingTitle(live.generation)
              : stageTitle({ position: live.generation.position, status })}
          {live.providerUnavailable && " · Comfy is not answering"}
        </p>
        <GeneratedOutputs outputs={outputs} />
        {status === "done" && media === null && (
          <p className="text-sm text-soft-foreground">
            This generation has no image or video to show here.
          </p>
        )}
      </main>
    </div>
  );
}

type GenerationActions = ComponentType<ResultGenerationActionsProps>;

/**
 * `/g/:id`: a Motion Transfer take (`MotionTransferView`, its result with `generationActions`),
 * or a generation of another workflow by the media of its outputs (`OutputsView`).
 */
export function GenerationView({
  data,
  generationActions,
}: {
  data: Result;
  generationActions: GenerationActions;
}) {
  return data.view === "motionTransfer" ? (
    <MotionTransferView data={data} generationActions={generationActions} />
  ) : (
    <OutputsView data={data} />
  );
}

/**
 * The `<title>` of `/g/:id` as it loads: a Motion Transfer take's; another workflow's generation
 * by the media of its outputs once done (`AI-generated video · Open Photon`), else neutral.
 */
export function generationTitle(data: Result) {
  if (data.view === "motionTransfer") {
    return "Your take · Motion Transfer · Open Photon";
  }

  const { media } = shownOutputs(data.outputs);

  return media ? generatedTitle(media) : "Generation · Open Photon";
}

/**
 * Step 4 and Step 5 of Motion Transfer. While it renders: the monitor, the named stages and
 * "Safe to leave" with the page's link. Failed or unknown: why, in plain words, and what can be
 * done. Done: the result (`useWhenDone` loads it when the stream says done). Retry (a new seed) and Re-run (the same recipe) open the child they start; a
 * re-run of a done generation answers with this one, which the page says. An action that needs
 * the access code asks for it in the dialog, then carries on.
 */
function MotionTransferView({
  data,
  generationActions,
}: {
  data: MotionTransferResult;
  generationActions: GenerationActions;
}) {
  const { character, direction, motionTitle, origin, recipe, rerunOfParent, signedIn, source } =
    data;

  const live = useLiveGeneration(data.generation);
  const { providerUnavailable } = live;

  const assets = useWhenDone(
    data.generation.id,
    live.generation.status === "done",
    resultAssets(data),
    resultAssets,
  );

  const compare = assets?.compare ?? null;
  const final = assets?.final ?? null;
  const poster = assets?.poster ?? null;

  // Done by the stream but its result not loaded yet: still finishing, as far as the page shows.
  const generation: GenerationSnapshot =
    live.generation.status === "done" && !final
      ? { ...live.generation, status: "finalizing" }
      : live.generation;

  const navigate = useNavigate();
  const nextSignal = useRequestSignal();
  const access = useAccessCode();
  const [child, setChild] = useState<ChildState>({ state: "idle" });
  const done = generation.status === "done" && final !== null;

  /**
   * `POST /api/generations/:id/retry` or `…/rerun`, then opens the generation it answers with. A
   * re-run of a done generation answers with this one (same recipe, same result, nothing
   * rendered), so the page says so instead.
   */
  async function startChild(action: "rerun" | "retry") {
    // Not passed to the request: a request that reached the server finishes there. Leaving the
    // page only drops the navigation to the child.
    const signal = nextSignal();

    setChild({ action, state: "running" });

    const answer = await callApi(
      generationReceiptSchema,
      `/api/generations/${generation.id}/${action}`,
      { method: "POST" },
    );

    if (signal.aborted) {
      return;
    }

    if ("refusal" in answer) {
      if (answer.refusal.reason === "access_required") {
        setChild({ action, state: "needs-code" });
        access.hold("child", action, () => void startChild(action));
      } else {
        setChild({ action, message: answer.refusal.message, state: "refused" });
      }
    } else if (answer.data.id === generation.id) {
      setChild({ state: "reused" });
    } else {
      await navigate({ params: { generationId: answer.data.id }, to: "/g/$generationId" });
    }
  }

  // The wizard with this take's picks and direction (`from`), at a step.
  const shot: MotionTransferDraft = {
    character: generation.character_id ?? undefined,
    from: generation.id,
    motion: source.id,
  };

  const failedRender = ["failed", "unknown", "cancelled"].includes(generation.status);
  const running = !isFinished(generation.status);
  const portrait = recipe.params.height >= recipe.params.width;
  const takeName = `Take ${generation.id.slice(0, 8)}`;

  const steps: HeaderStep[] = [
    { label: "Motion", search: { ...shot, step: "motion" }, state: "done" },
    { label: "Character", search: { ...shot, step: "character" }, state: "done" },
    { label: "Direct", search: { ...shot, step: "direct" }, state: "done" },
    { label: "Render", search: null, state: failedRender ? "failed" : done ? "done" : "current" },
  ];

  const status = (
    <p
      aria-label="Generation status"
      className={cn(
        "inline-flex items-center gap-2 hud",
        failedRender ? "text-destructive-foreground" : "text-muted-foreground",
        generation.status === "unknown" && "text-warning-foreground",
      )}
      data-status={generation.status}
      role="status"
    >
      <StatusDot
        tone={
          done ? "ok" : running ? "tally" : generation.status === "unknown" ? "warning" : "danger"
        }
      />
      {done
        ? `${takeName} · Done · ${duration(final.duration_ms ?? 0)}`
        : running
          ? `Step 4 of 4 · ${stageTitle(generation)}`
          : generation.status === "unknown"
            ? "Status unknown"
            : generation.status === "cancelled"
              ? "Cancelled"
              : "Render stopped"}
    </p>
  );

  const parentNote = generation.parent_id && (
    <p className="text-sm text-soft-foreground">
      {rerunOfParent ? "A re-run of the recipe of " : "A retry of "}
      <Link
        className="text-foreground underline decoration-edge-strong underline-offset-3 hover:decoration-brand"
        params={{ generationId: generation.parent_id }}
        to="/g/$generationId"
      >
        the earlier generation
      </Link>
      {rerunOfParent ? ", with the same seed." : ", with a new seed."}
    </p>
  );

  const characterName =
    character?.title ?? (generation.character_id ? "Your character" : "The character");

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <MotionTransferHeader
        end={done ? "new-shot" : "exit"}
        mobileStatus={done ? takeName : undefined}
        onAccess={access.unlock}
        signedIn={signedIn}
        steps={steps}
      />
      <main className="mx-auto w-full max-w-330 px-4 pt-6 pb-18 sm:px-8 lg:pt-10">
        {done ? (
          <div className="flex flex-col gap-4">
            {parentNote}
            <ResultView
              character={character}
              child={child}
              compare={compare ? mediaUrl(compare) : undefined}
              draft={snapshotDraft({ ...shot, ...directionFields(direction) })}
              final={final}
              generation={generation}
              generationActions={generationActions}
              onRerun={() => void startChild("rerun")}
              origin={origin}
              poster={poster ? mediaUrl(poster) : undefined}
              recipe={recipe}
              source={source}
              status={status}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-10 lg:flex-row lg:items-start lg:justify-center lg:gap-14">
            <RenderMonitor
              background={
                character ? (
                  <img alt="" className="size-full object-cover" src={mediaUrl(character.image)} />
                ) : (
                  <ClipStill src={mediaUrl(source)} />
                )
              }
              generation={generation}
              portrait={portrait}
              size={`${recipe.params.width}×${recipe.params.height}`}
              target={recipe.target === "cloud" ? "Comfy Cloud" : "Self-hosted"}
            />
            <div className="flex w-full max-w-150 min-w-0 flex-col gap-7 lg:pt-8">
              <div className="flex flex-col gap-3">
                {status}
                <h1 className="font-display text-3xl leading-none font-bold tracking-display sm:text-4xl lg:text-5xl">
                  {running ? "Rendering your shot" : endingTitle(generation)}
                </h1>
                {running && (
                  <p className="text-lg text-pretty text-soft-foreground">
                    {characterName} is taking on{" "}
                    {motionTitle ? `the ${motionTitle.toLowerCase()}` : "your clip"}. This page
                    updates on its own and shows the result when it's ready.
                  </p>
                )}
                {parentNote}
              </div>
              {running ? (
                <RenderProgress
                  generation={generation}
                  pageUrl={`${origin}/g/${generation.id}`}
                  providerUnavailable={providerUnavailable}
                />
              ) : (
                <RenderEnded
                  child={child}
                  generation={generation}
                  onChild={(action) => void startChild(action)}
                  seed={recipe.params.seed}
                  shot={shot}
                />
              )}
              <div className="flex flex-wrap items-center gap-3.5">
                <span className="relative h-13 w-10 overflow-hidden rounded-lg border bg-muted">
                  <ClipStill
                    label={`Motion: ${motionTitle ?? "your clip"}`}
                    src={mediaUrl(source)}
                  />
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  +
                </span>
                <span className="relative h-13 w-10 overflow-hidden rounded-lg border bg-muted">
                  {character && (
                    <img
                      alt={`Character: ${characterName}`}
                      className="absolute inset-0 size-full object-cover"
                      src={mediaUrl(character.image)}
                    />
                  )}
                </span>
                <span className="text-sm text-soft-foreground">
                  {motionTitle ?? "Your clip"} · {characterName} · seed {recipe.params.seed}
                </span>
              </div>
            </div>
          </div>
        )}
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
  );
}
