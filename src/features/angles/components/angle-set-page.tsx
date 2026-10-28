import { Link } from "@tanstack/react-router";
import {
  CheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LibraryIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ComponentType, useCallback, useEffect, useReducer, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import { fetchAngleSet, retryView, saveViewToLibrary } from "#/features/angles/angles-client";
import {
  type AngleSet,
  type AngleSetItem,
  VIEW_OUTPUT,
  viewLabels,
} from "#/features/angles/contracts";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow } from "#/shared/components/brand";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { SiteHeader } from "#/shared/components/site";
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

/** A view's state in words, for its badge and while it has no image. */
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

/** One view of the set: its state, its image once done, and what can be done with it. */
function ViewCard({
  actions: Actions,
  item,
  onAccess,
  onChange,
  setId,
}: {
  actions?: ComponentType<ViewActionsProps>;
  item: AngleSetItem;
  onAccess: (resume: () => void) => void;
  onChange: () => void;
  setId: string;
}) {
  const { generation } = useLiveGeneration(item.generation);
  const label = viewLabels[item.view];
  const image = generation.outputs.find((output) => output.name === VIEW_OUTPUT);
  const [busy, setBusy] = useState<"retry" | "save" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [savedId, setSavedId] = useState(item.saved_character_id);
  const saved = savedId ?? item.saved_character_id;

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

  return (
    <li
      aria-label={`${label}: ${statusLabel(generation)}`}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{label}</h3>
        <Badge variant={generation.status === "done" ? "brand" : "default"}>
          {statusLabel(generation)}
        </Badge>
      </div>

      <div className="relative aspect-3/5 overflow-hidden rounded-xl bg-foreground/5">
        {image && image.media === "image" ? (
          <>
            <img
              alt={`${label} view, ${GENERATED_IMAGE_ALT}`}
              className="absolute inset-0 size-full object-contain"
              src={mediaUrl(image.asset)}
            />
            <span className="absolute top-2.5 left-2.5">
              <Badge variant="solid">AI-generated image</Badge>
            </span>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-soft-foreground">
            {generation.status === "failed" || generation.status === "cancelled" ? (
              <>
                <TriangleAlertIcon
                  aria-hidden="true"
                  className="size-5 text-destructive-foreground"
                />
                <span className="line-clamp-6">
                  {generation.error_message ?? "This view failed."}
                </span>
              </>
            ) : generation.status === "unknown" ? (
              <span className="line-clamp-8">
                Comfy may have accepted this view before its job was saved, so it is never sent
                again on its own.
              </span>
            ) : (
              <>
                <span>{statusLabel(generation)}</span>
                <div className="w-3/4">
                  <Progress aria-label={`${label} progress`} value={generation.progress ?? 0} />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {item.reused && generation.status === "done" && (
        <p className="text-xs text-muted-foreground">Already rendered: came back free.</p>
      )}
      {item.attempt > 0 && (
        <p className="text-xs text-muted-foreground">
          Attempt {item.attempt + 1}, after a failure.
        </p>
      )}

      {image && image.media === "image" && (
        <div aria-label={`${label} actions`} className="mt-auto flex flex-col gap-2" role="group">
          {saved ? (
            <Button asChild size="sm" variant="outline">
              <a href={`/characters?selected=${saved}`}>
                <CheckIcon />
                Saved to library
              </a>
            </Button>
          ) : (
            <Button
              disabled={busy === "save"}
              onClick={() => void run("save")}
              size="sm"
              variant="photon"
            >
              <LibraryIcon />
              {busy === "save" ? "Saving…" : "Save to library"}
            </Button>
          )}
          {Actions && <Actions generationId={generation.id} output={VIEW_OUTPUT} />}
          <div className="flex flex-wrap justify-center gap-1">
            <Button asChild size="sm" variant="ghost">
              <a download href={`${mediaUrl(image.asset)}?download=1`}>
                <DownloadIcon />
                Download
              </a>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link params={{ generationId: generation.id }} to="/g/$generationId">
                <ExternalLinkIcon />
                Open
              </Link>
            </Button>
          </div>
        </div>
      )}

      {(generation.status === "failed" || generation.status === "cancelled") && (
        <div className="mt-auto grid">
          <Button
            aria-label={`Retry ${label}`}
            disabled={busy === "retry"}
            onClick={() => void run("retry")}
            size="sm"
            variant="outline"
          >
            <RotateCwIcon />
            {busy === "retry" ? "Retrying…" : "Retry"}
          </Button>
        </div>
      )}

      {problem && (
        <p className="text-xs text-destructive-foreground" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}

/** The page while it has no set to show: loading, the code needed, no such set, or a failed read. */
function SetNotice({
  onAccess,
  onRetry,
  state,
}: {
  onAccess: () => void;
  onRetry: () => void;
  state: Exclude<SetState, { kind: "ready" }>;
}) {
  if (state.kind === "loading") {
    return (
      <p className="text-muted-foreground" role="status">
        Loading the angle set…
      </p>
    );
  }

  const notices = {
    access: { action: "Enter code", onClick: onAccess, text: "Enter the access code to see it." },
    error: {
      action: "Try again",
      onClick: onRetry,
      text: state.kind === "error" ? state.refusal.message : "",
    },
    missing: { action: null, onClick: onRetry, text: "No angle set has this link." },
  };

  const notice = notices[state.kind];

  return (
    <section
      className="flex flex-col items-start gap-4"
      role={state.kind === "error" ? "alert" : undefined}
    >
      <h1 className="font-display text-4xl font-bold tracking-display">
        {state.kind === "missing" ? "Angle set not found" : "Angle set"}
      </h1>
      <p className="text-soft-foreground">{notice.text}</p>
      {notice.action ? (
        <Button onClick={notice.onClick} variant="outline">
          {notice.action}
        </Button>
      ) : (
        <Link className="underline underline-offset-3" to="/angles">
          Shots & Angles
        </Link>
      )}
    </section>
  );
}

/**
 * An angle set at `/angles/:id`: the character it started from and its views side by side, each
 * with its own state, image, Download, Save to library (`createFromGeneration`, once per
 * generation) and `viewActions` from the composition. The views render on the server whether or
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
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category="Image">
        {state.kind !== "loading" && (
          <AccessStatus onOpen={() => onAccess(reload)} signedIn={state.kind !== "access"} />
        )}
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-330 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
        {state.kind !== "ready" && (
          <SetNotice onAccess={() => onAccess(reload)} onRetry={reload} state={state} />
        )}
        {state.kind === "ready" && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="flex items-center gap-4">
                {state.set.character && (
                  <img
                    alt={state.set.character.title ?? "The set's character"}
                    className="h-24 w-16 rounded-lg border object-cover"
                    src={mediaUrl(state.set.character.image)}
                  />
                )}
                <div className="flex flex-col gap-2">
                  <Hud>Shots & Angles · seed {state.set.seed}</Hud>
                  <h1 className="font-display text-4xl leading-none font-bold tracking-display">
                    {state.set.character?.title ?? "Your character"}, {state.set.items.length}{" "}
                    {state.set.items.length === 1 ? "view" : "views"}
                  </h1>
                </div>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link search={{ character: state.set.character?.id }} to="/angles">
                  New angle set
                </Link>
              </Button>
            </div>
            <ul aria-label="Views" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {state.set.items.map((item) => (
                <ViewCard
                  actions={viewActions}
                  item={item}
                  key={item.generation.id}
                  onAccess={onAccess}
                  onChange={reload}
                  setId={state.set.id}
                />
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              Views render one at a time on the server; you can leave this page and come back. A
              saved view becomes a library character you can animate or use again here.
            </p>
          </>
        )}
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
  );
}
