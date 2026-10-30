import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  CompassIcon,
  DownloadIcon,
  HourglassIcon,
  LockIcon,
  MaximizeIcon,
  PlusIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";

import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import { fetchAngleSet, retryView, saveViewToLibrary } from "#/features/angles/angles-client";
import {
  type AngleSet,
  type AngleSetItem,
  angleViews,
  VIEW_OUTPUT,
  viewLabels,
} from "#/features/angles/contracts";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { PageHeading } from "#/shared/components/page-heading";
import { ResultFigure, SaveToLibrary } from "#/shared/components/result-figure";
import { SitePage } from "#/shared/components/site";
import { StableText } from "#/shared/components/stable-text";
import { StateCard } from "#/shared/components/state-card";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";
import { useLiveGeneration } from "#/shared/use-live-generation";

type SetState =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "missing" }
  | { kind: "error"; refusal: Refusal }
  | { kind: "ready"; set: AngleSet };

/** What the page shows for a read of the set: the set, or why there is none. */
function stateOf(result: { data: AngleSet } | { refusal: Refusal }): SetState {
  if ("data" in result) {
    return { kind: "ready", set: result.data };
  }

  const { reason } = result.refusal;

  if (reason === "access_required" || reason === "not_found") {
    return { kind: reason === "not_found" ? "missing" : "access" };
  }

  return { kind: "error", refusal: result.refusal };
}

/**
 * What a done view's card offers beside Download and Save to library, filled by the composition
 * (another feature's action on this image, e.g. Animate): the view's generation and image output.
 */
type ViewActionsProps = { generationId: string; output: string };

/**
 * `GET /api/angle-sets/:id`, read once and again on `reload` (a retry made a view's new
 * generation, or the access code was entered). Each view then follows its own generation's event
 * stream (`useLiveGeneration`), so the set itself is not polled.
 */
function useAngleSet(id: string) {
  const [state, setState] = useState<SetState>({ kind: "loading" });
  const [reads, reload] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const controller = new AbortController();
    const read = fetchAngleSet(id, controller.signal);

    void read.then((result) => controller.signal.aborted || setState(stateOf(result)));

    return () => controller.abort();
  }, [id, reads]);

  return { reload, state };
}

/** A view's state in words, for its name in the list and its card while it has no image. */
function statusLabel({ position, progress, status }: AngleSetItem["generation"]) {
  switch (status) {
    case "waiting":
      return position ? `Waiting · ${position} in line` : "Waiting";
    case "preparing":
      return "Starting…";
    case "queued":
    case "running":
      return progress === null ? "Queued on Comfy" : `Rendering ${progress}%`;
    case "finalizing":
      return "Saving…";
    case "done":
      return "Done";
    case "unknown":
      return "Unknown";
    default:
      return "Failed";
  }
}

/** The card of a view on its way: what it is doing, and that nobody has to stay for it. */
function pendingCopy(generation: AngleSetItem["generation"]) {
  if (generation.status !== "waiting") {
    return { text: "It keeps going, so you can leave.", title: statusLabel(generation) };
  }

  const ahead = generation.position === null ? 0 : generation.position - 1;
  const line = ahead > 0 ? `${ahead} ${ahead === 1 ? "take is" : "takes are"} ahead of it. ` : "";

  return { text: `${line}It starts by itself, so you can leave.`, title: "In line" };
}

const viewGrid = "grid grid-fill-60 gap-4";
const viewAspect = "aspect-9/14";

/**
 * A view with no image yet: `ResultFigure`'s box and caption line, without its AI-generated tag,
 * so the card keeps its size and the picture lands exactly here.
 */
function ViewFrame({
  caption,
  children,
  className,
  meta,
}: {
  caption: string;
  children?: ReactNode;
  className?: string;
  meta?: ReactNode;
}) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2.5">
      <div
        className={cn(
          "relative overflow-hidden rounded-field border bg-screen",
          viewAspect,
          className,
        )}
      >
        {children}
      </div>
      <figcaption className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="min-w-0 truncate type-label" title={caption}>
          {caption}
        </span>
        {meta && (
          <span className="max-w-1/2 shrink-0 truncate type-caption text-muted-foreground">
            {meta}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

// `StateCard` filling a `ViewFrame`: the frame already draws the box.
const frameCard = "absolute inset-0 min-h-0 rounded-none border-0 bg-transparent p-5";

/** One view of the set: its state, its image once done, and what can be done with it. */
function ViewCard({
  actions: Actions,
  backdrop,
  item,
  onAccess,
  onChange,
  setId,
}: {
  actions?: ComponentType<ViewActionsProps>;
  backdrop: string | undefined;
  item: AngleSetItem;
  onAccess: (resume: () => void) => void;
  onChange: () => void;
  setId: string;
}) {
  const { generation } = useLiveGeneration(item.generation);
  const label = viewLabels[item.view];
  const output = generation.outputs.find((each) => each.name === VIEW_OUTPUT);
  const image = output?.media === "image" ? output : null;
  const [busy, setBusy] = useState<"retry" | "save" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [savedId, setSavedId] = useState(item.saved_character_id);
  const saved = savedId ?? item.saved_character_id;
  const failed = generation.status === "failed" || generation.status === "cancelled";

  async function run(kind: "retry" | "save") {
    setBusy(kind);
    setProblem(null);

    const result =
      kind === "retry" ? await retryView(item) : await saveViewToLibrary(setId, item.position);

    setBusy(null);

    if ("data" in result) {
      if ("origin" in result.data) {
        setSavedId(result.data.id);
      } else {
        onChange();
      }
    } else if (result.refusal.reason === "access_required") {
      onAccess(() => void run(kind));
    } else {
      setProblem(result.refusal.message);
    }
  }

  const note = saved
    ? "Saved"
    : item.attempt > 0
      ? `Attempt ${item.attempt + 1}`
      : item.reused && generation.status === "done"
        ? "Reused, free"
        : undefined;

  const pending = pendingCopy(generation);
  const failure = problem ?? generation.error_message ?? "This view failed.";

  return (
    <li aria-label={`${label}: ${statusLabel(generation)}`} className="min-w-0">
      {image ? (
        <ResultFigure
          actions={
            <div aria-label={`${label} actions`} className="contents" role="group">
              <Button aria-label="Download" asChild size="icon" title="Download" variant="scrim">
                <a download href={`${mediaUrl(image.asset)}?download=1`}>
                  <DownloadIcon aria-hidden="true" strokeWidth={1.75} />
                </a>
              </Button>
              <SaveToLibrary
                disabled={busy === "save"}
                onSave={() => void run("save")}
                saved={saved}
                saving={busy === "save"}
              />
              {Actions && <Actions generationId={generation.id} output={VIEW_OUTPUT} />}
              <Button aria-label="Open" asChild size="icon" title="Open" variant="scrim">
                <Link params={{ generationId: generation.id }} to="/g/$generationId">
                  <MaximizeIcon aria-hidden="true" strokeWidth={1.75} />
                </Link>
              </Button>
            </div>
          }
          aspect={viewAspect}
          caption={label}
          meta={note}
          revealActions
        >
          <img
            alt={`${label} view, ${GENERATED_IMAGE_ALT}`}
            className="absolute inset-0 size-full object-cover object-top"
            src={mediaUrl(image.asset)}
          />
          {problem && (
            <p
              className="absolute inset-x-2.5 top-10 line-clamp-3 rounded-md bg-background/85 px-2.5 py-1.5 type-caption wrap-anywhere text-destructive-foreground"
              role="alert"
              title={problem}
            >
              {problem}
            </p>
          )}
        </ResultFigure>
      ) : (
        <ViewFrame caption={label} meta={note}>
          {failed ? (
            <StateCard
              backdrop={backdrop}
              className={frameCard}
              heading="h3"
              icon={TriangleAlertIcon}
              text={
                <span className="line-clamp-4" role={problem ? "alert" : undefined} title={failure}>
                  {failure}
                </span>
              }
              title="This view didn't finish"
              tone="warning"
            >
              <Button
                aria-label={`Try again: ${label}`}
                disabled={busy === "retry"}
                onClick={() => void run("retry")}
              >
                <RotateCwIcon aria-hidden="true" />
                <StableText
                  current={busy === "retry" ? "Retrying…" : "Try again"}
                  labels={["Try again", "Retrying…"]}
                />
              </Button>
            </StateCard>
          ) : generation.status === "unknown" ? (
            <StateCard
              backdrop={backdrop}
              className={frameCard}
              heading="h3"
              icon={TriangleAlertIcon}
              text={
                <span className="line-clamp-5">
                  Comfy may have accepted this view before its job was saved, so it is never sent
                  again on its own.
                </span>
              }
              title="Status unknown"
              tone="warning"
            />
          ) : (
            <StateCard
              backdrop={backdrop}
              className={frameCard}
              heading="h3"
              icon={HourglassIcon}
              text={<span className="block min-h-10">{pending.text}</span>}
              title={pending.title}
              tone={backdrop ? "quiet" : "brand"}
            >
              <span className="w-full max-w-50">
                <Progress aria-label={`${label} progress`} value={generation.progress ?? 0} />
              </span>
            </StateCard>
          )}
        </ViewFrame>
      )}
    </li>
  );
}

/** The way to a new set, carrying the character when the set still has it. */
function NewSetLink({ character }: { character?: string }) {
  return (
    <Button asChild variant="outline">
      <Link search={{ character }} to="/angles">
        <PlusIcon aria-hidden="true" />
        <span>New set</span>
      </Link>
    </Button>
  );
}

const subtitle = "Save a view to use it as a character.";

/** The page before the set's first read: its shape, so the views land where they will stay. */
function SetSkeleton() {
  return (
    <>
      <p className="sr-only" role="status">
        Loading the angle set…
      </p>
      <PageHeading
        actions={<NewSetLink />}
        subtitle={subtitle}
        title={<span className="invisible">Angle set</span>}
      />
      <ul aria-hidden="true" className={viewGrid}>
        {angleViews.map((view) => (
          <li className="min-w-0" key={view}>
            <ViewFrame caption={" "} className="motion-safe:animate-pulse" />
          </li>
        ))}
      </ul>
    </>
  );
}

/** The page while it has no set to show: the code needed, no such set, or a failed read. */
function SetNotice({
  onAccess,
  onRetry,
  state,
}: {
  onAccess: () => void;
  onRetry: () => void;
  state: Exclude<SetState, { kind: "loading" | "ready" }>;
}) {
  if (state.kind === "missing") {
    return (
      <StateCard
        className="min-h-120"
        heading="h1"
        icon={CompassIcon}
        text="This angle set doesn't exist."
        title="Nothing here"
      >
        <Button asChild variant="outline">
          <Link to="/angles">Shots & Angles</Link>
        </Button>
      </StateCard>
    );
  }

  if (state.kind === "access") {
    return (
      <StateCard
        className="min-h-120"
        heading="h1"
        icon={LockIcon}
        text="Enter the access code to see this angle set."
        title="This needs an access code"
      >
        <Button onClick={onAccess} variant="outline">
          Enter code
        </Button>
      </StateCard>
    );
  }

  return (
    <div role="alert">
      <StateCard
        className="min-h-120"
        heading="h1"
        icon={TriangleAlertIcon}
        text={state.refusal.message}
        title="This angle set didn't load"
        tone="warning"
      >
        <Button onClick={onRetry} variant="outline">
          Try again
        </Button>
      </StateCard>
    </div>
  );
}

/**
 * An angle set at `/angles/:id`: its views side by side, each keeping one box from waiting to done,
 * with its own state, image, Save to library (`createFromGeneration`, once per generation),
 * Download, Open and `viewActions` from the composition. The views render on the server whether or
 * not this page is open. A failed view offers the shared retry (a new seed); an unknown one is
 * never retried: Comfy may still be rendering it.
 */
export function AngleSetPage({
  angleSetId,
  viewActions,
}: {
  angleSetId: string;
  viewActions?: ComponentType<ViewActionsProps>;
}) {
  const { reload, state } = useAngleSet(angleSetId);
  const access = useAccessCode();

  const onAccess = useCallback(
    (resume: () => void) => access.hold("angle-set", "unlock", resume),
    [access.hold],
  );

  return (
    <SitePage category="Image" gap={7} onAccess={() => onAccess(reload)} top={10}>
      {state.kind === "loading" && <SetSkeleton />}
      {state.kind !== "loading" && state.kind !== "ready" && (
        <SetNotice onAccess={() => onAccess(reload)} onRetry={reload} state={state} />
      )}
      {state.kind === "ready" && (
        <>
          <PageHeading
            actions={<NewSetLink character={state.set.character?.id} />}
            subtitle={subtitle}
            title={`${state.set.character?.title ?? "Your character"}, ${state.set.items.length} ${
              state.set.items.length === 1 ? "view" : "views"
            }`}
          />
          <ul aria-label="Views" className={viewGrid}>
            {state.set.items.map((item) => (
              <ViewCard
                actions={viewActions}
                backdrop={state.set.character ? mediaUrl(state.set.character.image) : undefined}
                item={item}
                key={item.generation.id}
                onAccess={onAccess}
                onChange={reload}
                setId={state.set.id}
              />
            ))}
          </ul>
        </>
      )}

      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}
