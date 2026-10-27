import { Link } from "@tanstack/react-router";
import {
  ClockIcon,
  DownloadIcon,
  ExternalLinkIcon,
  HelpCircleIcon,
  RotateCwIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Progress } from "#/components/ui/progress";
import { Textarea } from "#/components/ui/textarea";
import { IMAGE_EDIT_OUTPUT } from "#/features/imageEdit";
import { StylePicker } from "#/features/storyboard/components/style-picker";
import type { Storyboard, StoryboardCard, StoryboardStyle } from "#/features/storyboard/contracts";
import { characterAlt, characterName } from "#/features/storyboard/names";
import {
  fetchStoryboard,
  postCardGenerations,
  putStoryboard,
  retryGeneration,
} from "#/features/storyboard/storyboard-client";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow } from "#/shared/components/brand";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { SiteHeader } from "#/shared/components/site";
import type { GenerationSnapshot } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { useAccessCode } from "#/shared/use-access-code";

// How often the page reads the storyboard again while a card or the scene split is on its way.
// The dispatcher renders them whether or not the page is open; this only keeps the view current.
const POLL_MS = 2000;

const HELD = "storyboard";

type PageState =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "missing" }
  | { kind: "error"; refusal: Refusal }
  | { kind: "ready"; storyboard: Storyboard };

type CardState = "empty" | "waiting" | "running" | "done" | "failed" | "unknown";

function cardState(generation: GenerationSnapshot | null): CardState {
  switch (generation?.status) {
    case undefined:
      return "empty";
    case "waiting":
      return "waiting";
    case "preparing":
    case "queued":
    case "running":
    case "finalizing":
      return "running";
    case "done":
      return "done";
    case "unknown":
      return "unknown";
    case "failed":
    case "cancelled":
      return "failed";
  }
}

const onItsWay = (storyboard: Storyboard) =>
  storyboard.scenes.state === "writing" ||
  storyboard.cards.some((card) => ["waiting", "running"].includes(cardState(card.generation)));

/**
 * `GET /api/storyboards/:id`, read again every `POLL_MS` while something is on its way (or the
 * last read failed), and at once on `reload`. A storyboard already shown stays when a read fails.
 */
function useStoryboard(id: string) {
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [requested, reload] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    const read = async () => {
      const result = await fetchStoryboard(id, controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      if ("data" in result) {
        setState({ kind: "ready", storyboard: result.data });
      } else if (result.refusal.reason === "access_required") {
        setState({ kind: "access" });
      } else if (result.refusal.reason === "not_found") {
        setState({ kind: "missing" });
      } else {
        setState((current) =>
          current.kind === "ready" ? current : { kind: "error", refusal: result.refusal },
        );
      }

      const again =
        "data" in result
          ? onItsWay(result.data)
          : !["access_required", "not_found"].includes(result.refusal.reason ?? "");

      if (again) {
        timer = window.setTimeout(() => void read(), POLL_MS);
      }
    };

    void read();

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [id, requested]);

  return { reload, setState, state };
}

/**
 * A storyboard at `/storyboards/:id`: its character and sequence, the scene split's state, and
 * its four cards, each with an editable description, its own image and progress, and its own
 * Generate / Regenerate / Try again; "Generate all" renders every card with a description. A
 * card's actions area (`cardActions`) holds Download and the result page; the composition may
 * add more (Animate). Edits stay on the page until saved (Save, or any Generate, which saves
 * first), so a reload shows what was saved.
 */
export function StoryboardPage({
  cardActions,
  storyboardId,
}: {
  cardActions?: (card: StoryboardCard) => ReactNode;
  storyboardId: string;
}) {
  const { reload, setState, state } = useStoryboard(storyboardId);
  const access = useAccessCode();
  const askForCode = useCallback(() => access.hold(HELD, "unlock", reload), [access.hold, reload]);

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category="Image">
        {state.kind !== "loading" && (
          <AccessStatus onOpen={askForCode} signedIn={state.kind !== "access"} />
        )}
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-330 flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
        {state.kind === "loading" && (
          <p className="text-muted-foreground" role="status">
            Loading the storyboard…
          </p>
        )}
        {state.kind === "access" && (
          <section className="flex flex-col items-start gap-4">
            <h1 className="font-display text-4xl leading-none font-bold tracking-display">
              Storyboard
            </h1>
            <p className="text-soft-foreground">Enter the access code to see this storyboard.</p>
            <Button onClick={askForCode} variant="outline">
              Enter code
            </Button>
          </section>
        )}
        {state.kind === "missing" && (
          <section className="flex flex-col items-start gap-4">
            <h1 className="font-display text-4xl leading-none font-bold tracking-display">
              Storyboard not found
            </h1>
            <Link className="underline underline-offset-3" to="/storyboards">
              All storyboards
            </Link>
          </section>
        )}
        {state.kind === "error" && (
          <section className="flex flex-col items-start gap-4" role="alert">
            <p className="text-destructive-foreground">{state.refusal.message}</p>
            <Button onClick={reload} variant="outline">
              Try again
            </Button>
          </section>
        )}
        {state.kind === "ready" && (
          <StoryboardView
            cardActions={cardActions}
            onAccess={askForCode}
            onChange={reload}
            onStored={(storyboard) => {
              setState({ kind: "ready", storyboard });
              reload();
            }}
            storyboard={state.storyboard}
          />
        )}
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
  );
}

type Edits = { descriptions: Record<number, string>; style?: StoryboardStyle; title?: string };

function StoryboardView({
  cardActions,
  onAccess,
  onChange,
  onStored,
  storyboard,
}: {
  cardActions?: (card: StoryboardCard) => ReactNode;
  onAccess: () => void;
  onChange: () => void;
  onStored: (storyboard: Storyboard) => void;
  storyboard: Storyboard;
}) {
  // What the user changed since the last save; everything else shows as stored, so the page's
  // reads while cards render never overwrite an edit.
  const [edits, setEdits] = useState<Edits>({ descriptions: {} });
  const [busy, setBusy] = useState<"save" | number[] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The key of the generations request on its way: kept until an answer comes, so sending it
  // again after a lost answer renders nothing twice.
  const pending = useRef<{ key: string; positions: string } | null>(null);

  const descriptions = storyboard.cards.map(
    (card) => edits.descriptions[card.position] ?? card.description,
  );

  const style = edits.style ?? storyboard.style;
  const title = edits.title ?? storyboard.title ?? "";

  const dirty =
    edits.style !== undefined ||
    edits.title !== undefined ||
    Object.keys(edits.descriptions).length > 0;

  const body = { descriptions, style, title };

  function refused(result: { refusal: Refusal }) {
    if (result.refusal.reason === "access_required") {
      onAccess();
    } else {
      setRefusal(result.refusal.message);
    }
  }

  async function save() {
    setBusy("save");
    setRefusal(null);

    const result = await putStoryboard(storyboard.id, body);

    setBusy(null);

    if ("data" in result) {
      setEdits({ descriptions: {} });
      onStored(result.data);
    } else {
      refused(result);
    }
  }

  async function generate(positions: number[]) {
    const asked = positions.join(",");

    if (pending.current?.positions !== asked) {
      pending.current = { key: crypto.randomUUID(), positions: asked };
    }

    setBusy(positions);
    setRefusal(null);

    const result = await postCardGenerations(
      storyboard.id,
      { ...body, positions },
      pending.current.key,
    );

    setBusy(null);

    if ("data" in result) {
      pending.current = null;
      setEdits({ descriptions: {} });
      onStored(result.data);

      return;
    }

    // A refusal the server answered is final for that key: the next try is a new request.
    if (result.refusal.reason !== undefined) {
      pending.current = null;
    }

    refused(result);
  }

  const renderable = storyboard.cards
    .filter((card) => {
      const state = cardState(card.generation);

      return descriptions[card.position]?.trim() && state !== "waiting" && state !== "running";
    })
    .map((card) => card.position);

  return (
    <>
      <section className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <img
          alt={characterAlt(storyboard.character)}
          className="aspect-4/7 w-28 shrink-0 rounded-2xl border bg-foreground/5 object-cover"
          src={mediaUrl(storyboard.character.image)}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Hud>Storyboard · {characterName(storyboard.character)}</Hud>
          <div className="flex flex-col gap-2">
            <Label htmlFor="storyboard-title">Title</Label>
            <Input
              id="storyboard-title"
              maxLength={80}
              onChange={(event) =>
                setEdits((current) => ({ ...current, title: event.target.value }))
              }
              placeholder={`${characterName(storyboard.character)}'s storyboard`}
              value={title}
            />
          </div>
          <p className="text-soft-foreground">
            <span className="font-medium text-foreground">Sequence: </span>
            {storyboard.sequence}
          </p>
          <StylePicker
            onChange={(next) => setEdits((current) => ({ ...current, style: next }))}
            value={style}
          />
          <ScenesNotice onAccess={onAccess} onChange={onChange} storyboard={storyboard} />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={busy !== null || renderable.length === 0}
              onClick={() => void generate(renderable)}
            >
              <SparklesIcon />
              {Array.isArray(busy) && busy.length > 1 ? "Starting…" : "Generate all"}
            </Button>
            <Button
              disabled={!dirty || busy !== null}
              onClick={() => void save()}
              variant="outline"
            >
              {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
            {refusal && (
              <p className="text-sm text-destructive-foreground" role="alert">
                {refusal}
              </p>
            )}
          </div>
        </div>
      </section>

      <ol aria-label="Scene cards" className="grid gap-4 md:grid-cols-2">
        {storyboard.cards.map((card) => (
          <SceneCard
            actions={cardActions?.(card)}
            busy={busy !== null}
            card={card}
            description={descriptions[card.position] ?? ""}
            key={card.position}
            onDescription={(text) =>
              setEdits((current) => ({
                ...current,
                descriptions: { ...current.descriptions, [card.position]: text },
              }))
            }
            onGenerate={() => void generate([card.position])}
            starting={Array.isArray(busy) && busy.includes(card.position)}
            writing={storyboard.scenes.state === "writing"}
          />
        ))}
      </ol>
    </>
  );
}

/** Where the scenes stand: being written by the text model, or the split failed (retry). */
function ScenesNotice({
  onAccess,
  onChange,
  storyboard,
}: {
  onAccess: () => void;
  onChange: () => void;
  storyboard: Storyboard;
}) {
  const [retrying, setRetrying] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { generation, message, state } = storyboard.scenes;

  if (state === "writing") {
    return (
      <p className="flex items-center gap-2 text-sm text-soft-foreground" role="status">
        <ClockIcon aria-hidden="true" className="size-4" />
        Writing four scenes from the sequence…
      </p>
    );
  }

  if (state !== "failed") {
    return null;
  }

  const retryable = generation?.status === "failed" || generation?.status === "cancelled";

  async function retry() {
    if (!generation) {
      return;
    }

    setRetrying(true);
    setRefusal(null);

    const result = await retryGeneration(generation.id);

    setRetrying(false);

    if ("data" in result) {
      onChange();
    } else if (result.refusal.reason === "access_required") {
      onAccess();
    } else {
      setRefusal(result.refusal.message);
    }
  }

  return (
    <div
      className="flex flex-col items-start gap-2 rounded-xl border border-destructive/40 p-3"
      role="alert"
    >
      <p className="flex items-center gap-2 text-sm">
        <TriangleAlertIcon aria-hidden="true" className="size-4 text-destructive-foreground" />
        {message}
      </p>
      {retryable && (
        <Button disabled={retrying} onClick={() => void retry()} size="sm" variant="outline">
          <RotateCwIcon />
          {retrying ? "Retrying…" : "Split again"}
        </Button>
      )}
      {refusal && <p className="text-xs text-destructive-foreground">{refusal}</p>}
    </div>
  );
}

const stateLabels: Record<CardState, string> = {
  done: "Rendered",
  empty: "Not rendered",
  failed: "Failed",
  running: "Rendering",
  unknown: "Unknown",
  waiting: "Waiting",
};

const stateBadges: Record<CardState, "brand" | "default" | "destructive" | "warning"> = {
  done: "brand",
  empty: "default",
  failed: "destructive",
  running: "default",
  unknown: "warning",
  waiting: "default",
};

/** One scene card: its description, its image or progress, and its own actions. */
function SceneCard({
  actions,
  busy,
  card,
  description,
  onDescription,
  onGenerate,
  starting,
  writing,
}: {
  actions: ReactNode;
  busy: boolean;
  card: StoryboardCard;
  description: string;
  onDescription: (text: string) => void;
  onGenerate: () => void;
  starting: boolean;
  writing: boolean;
}) {
  const { generation } = card;
  const state = cardState(generation);
  const number = card.position + 1;
  const image = generation?.outputs.find((output) => output.name === IMAGE_EDIT_OUTPUT);
  const asset = image && image.media !== "text" ? image.asset : null;
  const onWay = state === "waiting" || state === "running";

  return (
    <li
      aria-label={`Scene ${number}: ${stateLabels[state]}`}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Scene {number}</span>
        <Badge variant={stateBadges[state]}>{stateLabels[state]}</Badge>
      </div>

      <div className="relative aspect-7/4 overflow-hidden rounded-xl bg-foreground/5">
        {state === "done" && asset ? (
          <>
            <img
              alt={`${GENERATED_IMAGE_ALT} (scene ${number})`}
              className="absolute inset-0 size-full object-cover"
              src={mediaUrl(asset)}
            />
            <span className="absolute top-2 left-2">
              <Badge variant="solid">AI-generated image</Badge>
            </span>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-3 text-center text-sm">
            {state === "empty" && <span className="text-muted-foreground">No image yet</span>}
            {state === "waiting" && (
              <>
                <ClockIcon aria-hidden="true" className="size-5 text-muted-foreground" />
                <span>{generation?.position ? `${generation.position} in line` : "In line"}</span>
              </>
            )}
            {state === "running" && generation && (
              <>
                <span>
                  {generation.progress === null ? "Starting…" : `Rendering ${generation.progress}%`}
                </span>
                <div className="w-3/4">
                  <Progress
                    aria-label={`Scene ${number} progress`}
                    value={generation.progress ?? 0}
                  />
                </div>
              </>
            )}
            {state === "failed" && (
              <>
                <TriangleAlertIcon
                  aria-hidden="true"
                  className="size-5 text-destructive-foreground"
                />
                <span className="line-clamp-4 text-soft-foreground">
                  {generation?.error_message ?? "This scene failed."}
                </span>
              </>
            )}
            {state === "unknown" && (
              <>
                <HelpCircleIcon aria-hidden="true" className="size-5 text-warning-foreground" />
                <span className="line-clamp-6 text-soft-foreground">
                  Comfy may have accepted this scene before its job was saved. Check the rendering
                  backend before rendering it again.
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`scene-${card.position}`}>Scene {number} description</Label>
        <Textarea
          disabled={writing}
          id={`scene-${card.position}`}
          maxLength={1000}
          onChange={(event) => onDescription(event.target.value)}
          placeholder={writing ? "Writing…" : "What the character does, where, and the framing."}
          rows={4}
          value={description}
        />
      </div>

      {card.attempt > 0 && (
        <p className="text-xs text-muted-foreground">
          Attempt {card.attempt + 1}: rendered again after a failure.
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button
          aria-label={`${state === "empty" ? "Generate" : state === "failed" ? "Try again" : "Regenerate"} scene ${number}`}
          disabled={busy || onWay || writing || !description.trim()}
          onClick={onGenerate}
          size="sm"
          variant={state === "empty" ? "default" : "outline"}
        >
          {state === "failed" ? <RotateCwIcon /> : <SparklesIcon />}
          {starting
            ? "Starting…"
            : state === "empty"
              ? "Generate"
              : state === "failed"
                ? "Try again"
                : "Regenerate"}
        </Button>
        {state === "done" && asset && generation && (
          <div aria-label={`Scene ${number} actions`} className="flex flex-wrap gap-1" role="group">
            <Button asChild size="sm" variant="ghost">
              <a download href={`${mediaUrl(asset)}?download=1`}>
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
            {actions}
          </div>
        )}
      </div>
    </li>
  );
}
