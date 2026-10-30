import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { HourglassIcon, RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import {
  MotionTransferHeader,
  type HeaderStep,
} from "#/features/motionTransfer/components/motion-transfer-header";
import {
  type ChildState,
  endingTitle,
  RenderEndedCard,
  RenderEndedDetail,
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
import { Hud, StatusDot, Viewfinder } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";
import {
  GeneratedOutputs,
  generatedTitle,
  shownOutputs,
} from "#/shared/components/generated-outputs";
import { PageHeading } from "#/shared/components/page-heading";
import { Panel } from "#/shared/components/panel";
import { PublishLink } from "#/shared/components/publish-link";
import { SitePage } from "#/shared/components/site";
import { StableText } from "#/shared/components/stable-text";
import { StateCard } from "#/shared/components/state-card";
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
 * The stage's place on the page, whatever it shows: the take's own shape from the first paint, so
 * no state of a take moves it; on a phone a landscape stage is as tall as a state card, which 16:9
 * of that width could not hold. `live` lights it from under while the take is on its way.
 */
function Stage({
  children,
  live,
  portrait,
}: {
  children: React.ReactNode;
  live: boolean;
  portrait: boolean;
}) {
  return (
    <div className={cn("min-w-0 grow", portrait ? "max-w-97.5 basis-80" : "max-w-170 basis-150")}>
      <div
        className={cn(
          "relative rounded-2xl",
          portrait ? "aspect-9/16" : "max-sm:h-80 sm:aspect-video",
          live && "shadow-monitor",
        )}
      >
        {children}
      </div>
    </div>
  );
}

// `StateCard` in the stage: it fills the box, and the box decides the height.
const stageCard = "absolute inset-0 min-h-0";

/**
 * The percent in slots of its own: the sign stays put while the digits, right-aligned in the room
 * of two, tick up beside it (Syne's digits are not tabular), and 100 grows to the left.
 */
function StagePercent({ value }: { value: number }) {
  return (
    <span className="flex items-baseline font-display text-8xl leading-none font-bold tracking-display">
      <span className="flex w-29 justify-end whitespace-nowrap">{value}</span>
      <span className="text-4xl text-soft-foreground">%</span>
    </span>
  );
}

/**
 * The monitor of a take on its way: the character (or the clip) blurred behind the live percent,
 * under the viewfinder, with where it stands and which take it is. Decoration for assistive
 * technology, which hears the status line and the progress bar.
 */
function RenderMonitor({
  background,
  generation,
  take,
}: {
  background: React.ReactNode;
  generation: GenerationSnapshot;
  take: string;
}) {
  const rolling = generation.status === "running";

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-2xl bg-screen">
      <div className="absolute inset-0 scale-120 blur-backdrop brightness-38">{background}</div>
      <Viewfinder tone="brand" />
      <div className="absolute inset-x-7 top-6.5 flex items-center justify-between gap-3">
        <Hud className="inline-flex items-center gap-2" tone="foreground">
          <StatusDot tone={rolling ? "tally" : "brand"} />
          {rolling ? "Rec" : stageTitle(generation)}
        </Hud>
        <Hud tone="foreground">{take}</Hud>
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <StagePercent
          value={generation.status === "finalizing" ? 100 : (generation.progress ?? 0)}
        />
      </div>
    </div>
  );
}

/** A place in line in words, `1` being the next to start; no place known yet says only the rest. */
function placeInLine(position: number | null) {
  const rest = "It starts by itself, so you can leave.";

  if (position === null) {
    return rest;
  }

  const ahead = position - 1;

  return `${ahead === 0 ? "Yours is next." : ahead === 1 ? "One take is ahead of yours." : `${ahead} takes are ahead of yours.`} ${rest}`;
}

/** A waiting take's stage. The bar only moves: a line has a place in it, not a percent. */
function LineCard({ backdrop, position }: { backdrop?: string; position: number | null }) {
  return (
    <StateCard
      backdrop={backdrop}
      className={stageCard}
      icon={HourglassIcon}
      text={placeInLine(position)}
      title="In line"
      tone="quiet"
    >
      <span
        aria-hidden="true"
        className="relative h-1.5 w-50 overflow-hidden rounded-full bg-foreground/12"
      >
        <span className="absolute inset-0 bg-linear-to-r from-transparent via-brand to-transparent motion-safe:animate-sheen" />
      </span>
    </StateCard>
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
 * text. With the access code: a done generation of a workflow that publishes on request offers
 * "Publish & copy link" (`PublishLink`), and a failed or cancelled one Retry with a new seed
 * (`POST /api/generations/:id/retry`), which opens the child it starts.
 */
function OutputsView({ data }: { data: OutputsResult }) {
  const live = useLiveGeneration(data.generation);
  const { id, share_slug, status } = live.generation;
  const navigate = useNavigate();
  const nextSignal = useRequestSignal();

  const [retry, setRetry] = useState<{ message: string | null; pending: boolean }>({
    message: null,
    pending: false,
  });

  const outputs = live.generation.outputs.flatMap((output) =>
    output.media === "text" ? [] : [output],
  );

  const { media } = shownOutputs(outputs);
  // Before it has outputs, or when it ended without any, the page goes by what its workflow makes.
  const kind = media ?? data.media;
  const category = kind === "video" ? "Video" : kind === "image" ? "Image" : undefined;
  const publishable = data.signedIn && data.publish === "on-request" && status === "done";
  const retryable = data.signedIn && (status === "failed" || status === "cancelled");

  async function startRetry() {
    // Not passed to the request: a retry that reached the server starts there. Leaving the page
    // only drops the navigation to the child.
    const signal = nextSignal();

    setRetry({ message: null, pending: true });

    const answer = await callApi(generationReceiptSchema, `/api/generations/${id}/retry`, {
      method: "POST",
    });

    if (signal.aborted) {
      return;
    }

    if ("refusal" in answer) {
      setRetry({ message: answer.refusal.message, pending: false });

      return;
    }

    // The page is keyed by the generation, so the child opens with a stream of its own.
    await navigate({ params: { generationId: answer.data.id }, to: "/g/$generationId" });
  }

  return (
    <SitePage category={category} className="max-w-150" gap={6} top={6}>
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
            ? "Render stopped"
            : stageTitle({ position: live.generation.position, status })}
        {live.providerUnavailable && " · Comfy is not answering"}
      </p>
      {status === "done" ? (
        media === null ? (
          <StateCard
            heading="h1"
            text="This generation has no image or video to show here."
            title="Nothing to show"
          />
        ) : (
          <PageHeading title={`Your ${media} is ready`} />
        )
      ) : isFinished(status) ? (
        <StateCard
          heading="h1"
          icon={TriangleAlertIcon}
          text={live.generation.error_message}
          title={endingTitle(live.generation, kind === "image" ? "image" : "take")}
          tone="warning"
        >
          {retryable && (
            <Button disabled={retry.pending} onClick={() => void startRetry()}>
              <RotateCwIcon aria-hidden="true" />
              <StableText
                current={retry.pending ? "Retrying…" : "Try again"}
                labels={["Try again", "Retrying…"]}
              />
            </Button>
          )}
        </StateCard>
      ) : (
        <StateCard
          frame
          heading="h1"
          text={
            status === "waiting"
              ? placeInLine(live.generation.position)
              : "This page updates by itself."
          }
          title={status === "waiting" ? "In line" : "Rendering"}
        >
          <span className="block w-50">
            <Progress aria-label="Render progress" value={live.generation.progress ?? 0} />
          </span>
        </StateCard>
      )}
      {retry.message && (
        <p className="text-sm text-destructive-foreground" role="alert">
          {retry.message}
        </p>
      )}
      <GeneratedOutputs outputs={outputs} />
      {publishable && media !== null && (
        <Panel className="gap-3 p-5">
          <PublishLink generationId={id} media={media} slug={share_slug} />
        </Panel>
      )}
    </SitePage>
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
 * Step 4 and Step 5 of Motion Transfer. On its way: the stage (in line, then the monitor), the
 * track and "Safe to leave" with the page's link, all in one place through every status. Failed
 * or unknown: the stage says what happened and what can be done, beside why, in plain words.
 * Done: the result (`useWhenDone` loads it when the stream says done). Retry (a new seed) and
 * Re-run (the same recipe) open the child they start; a re-run of a done generation answers with
 * this one, which the page says. An action that needs the access code asks for it in the dialog,
 * then carries on.
 */
function MotionTransferView({
  data,
  generationActions,
}: {
  data: MotionTransferResult;
  generationActions: GenerationActions;
}) {
  const { character, direction, motionTitle, origin, recipe, rerunOfParent, source } = data;

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
      className="sr-only"
      data-status={generation.status}
      role="status"
    >
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
    <>
      {rerunOfParent ? "A re-run of the recipe of " : "A retry of "}
      <Link
        className="text-foreground underline decoration-edge-strong underline-offset-3 hover:decoration-brand"
        params={{ generationId: generation.parent_id }}
        to="/g/$generationId"
      >
        the earlier generation
      </Link>
      {rerunOfParent ? ", with the same seed." : ", with a new seed."}
    </>
  );

  const characterName =
    character?.title ?? (generation.character_id ? "Your character" : "The character");

  const characterImage = character ? mediaUrl(character.image) : undefined;

  return (
    <SitePage category="Video" gap={6} onAccess={access.unlock} top={6}>
      <MotionTransferHeader end={done ? "new-shot" : "exit"} steps={steps} />
      {done ? (
        <ResultView
          character={character}
          child={child}
          compare={compare ? mediaUrl(compare) : undefined}
          draft={snapshotDraft({ ...shot, ...directionFields(direction) })}
          final={final}
          generation={generation}
          generationActions={generationActions}
          note={parentNote}
          onRerun={() => void startChild("rerun")}
          origin={origin}
          poster={poster ? mediaUrl(poster) : undefined}
          recipe={recipe}
          source={source}
          status={status}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-x-16 gap-y-10">
          <Stage live={running} portrait={portrait}>
            {generation.status === "waiting" ? (
              <LineCard backdrop={characterImage} position={generation.position} />
            ) : running ? (
              <RenderMonitor
                background={
                  characterImage ? (
                    <img alt="" className="size-full object-cover" src={characterImage} />
                  ) : (
                    <ClipStill src={mediaUrl(source)} />
                  )
                }
                generation={generation}
                take={takeName}
              />
            ) : (
              <RenderEndedCard
                backdrop={characterImage}
                child={child}
                className={stageCard}
                generation={generation}
                onChild={(action) => void startChild(action)}
                shot={shot}
              />
            )}
          </Stage>
          <div className="flex max-w-150 min-w-0 grow-999 basis-110 flex-col gap-4">
            {status}
            {running ? (
              <>
                <PageHeading
                  className="pb-3"
                  subtitle={
                    <>
                      {characterName} is taking on{" "}
                      {motionTitle ? `the ${motionTitle.toLowerCase()}` : "your clip"}. This page
                      updates by itself. {parentNote}
                    </>
                  }
                  title="Rendering your shot"
                />
                <RenderProgress
                  generation={generation}
                  pageUrl={`${origin}/g/${generation.id}`}
                  providerUnavailable={providerUnavailable}
                />
              </>
            ) : (
              <RenderEndedDetail
                child={child}
                generation={generation}
                note={parentNote}
                onChild={(action) => void startChild(action)}
                seed={recipe.params.seed}
              />
            )}
          </div>
        </div>
      )}
      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}
