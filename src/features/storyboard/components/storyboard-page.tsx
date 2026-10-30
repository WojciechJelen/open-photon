import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ClockIcon,
  DownloadIcon,
  HelpCircleIcon,
  HourglassIcon,
  LoaderCircleIcon,
  MaximizeIcon,
  PencilIcon,
  RefreshCwIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Progress } from "#/components/ui/progress";
import { IMAGE_EDIT_OUTPUT } from "#/features/imageEdit";
import {
  StoryboardFrame,
  useStoryboardRead,
} from "#/features/storyboard/components/storyboard-frame";
import { StylePicker } from "#/features/storyboard/components/style-picker";
import type { Storyboard, StoryboardCard, StoryboardStyle } from "#/features/storyboard/contracts";
import { characterAlt, storyboardName } from "#/features/storyboard/names";
import {
  fetchStoryboard,
  postCardGenerations,
  putStoryboard,
  retryGeneration,
} from "#/features/storyboard/storyboard-client";
import { Hud } from "#/shared/components/brand";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { StableText } from "#/shared/components/stable-text";
import type { GenerationSnapshot } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";

const onItsWay = (storyboard: Storyboard) =>
  storyboard.scenes.state === "writing" ||
  storyboard.cards.some((card) => ["waiting", "running"].includes(cardState(card.generation)));

type CardState = "empty" | "waiting" | "running" | "done" | "failed" | "unknown";

/** A card's state in words the page uses, from its current generation's status. */
function cardState(generation: GenerationSnapshot | null): CardState {
  const status = generation?.status;

  if (!status) {
    return "empty";
  }

  if (status === "cancelled") {
    return "failed";
  }

  return status === "preparing" || status === "queued" || status === "finalizing"
    ? "running"
    : status;
}

const headingRow = "flex flex-wrap items-center justify-between gap-x-8 gap-y-4";

// The title and two lines of sequence, so that a long one moves nothing when the page is read.
const headingLead = "flex min-h-24.25 min-w-0 flex-1 basis-80 items-center gap-4";
const cardGrid = "grid grid-fit-105 gap-4";
const cardBox = "flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card/72";
const pictureTag = "absolute rounded-tag bg-background/66 px-1.75 py-0.75 text-foreground";

/**
 * A storyboard at `/storyboards/:id`: its character and sequence, the scene split's state, and
 * its four cards, each with an editable description, its own image and progress, and its own
 * Generate / Regenerate / Try again; "Generate all" renders every card with a description. A
 * card's actions area (`cardActions`) holds Download and the result page; the composition may
 * add more (Animate). Edits stay on the page until saved (Save, or any Generate, which saves
 * first), so a reload shows what was saved. The page reads the storyboard again while a card or
 * the split is on its way. Every card keeps one height: no state, and no text, moves another.
 */
export function StoryboardPage({
  cardActions,
  storyboardId,
}: {
  cardActions?: (card: StoryboardCard) => ReactNode;
  storyboardId: string;
}) {
  const { reload, show, state } = useStoryboardRead(
    (signal) => fetchStoryboard(storyboardId, signal),
    onItsWay,
  );

  return (
    <StoryboardFrame
      gap={7}
      holdKey="storyboard"
      loading={<StoryboardLoading />}
      noun="the storyboard"
      reload={reload}
      state={state}
      top={10}
    >
      {(storyboard, askForCode) => (
        <StoryboardView
          cardActions={cardActions}
          onAccess={askForCode}
          onChange={reload}
          onStored={(stored) => {
            show(stored);
            reload();
          }}
          storyboard={storyboard}
        />
      )}
    </StoryboardFrame>
  );
}

/** The page until the storyboard is read: its boxes, the size they will have. */
function StoryboardLoading() {
  return (
    <>
      <div aria-hidden="true" className={headingRow}>
        <div className={headingLead}>
          <div className="h-21 w-14 shrink-0 skeleton rounded-md" />
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2.5" inert>
          <StylePicker onChange={() => undefined} value={null} />
          <Button disabled variant="outline">
            Saved
          </Button>
          <Button disabled variant="photon">
            <SparklesIcon />
            Generate all
          </Button>
        </div>
      </div>
      <div aria-hidden="true" className={cardGrid}>
        {["1", "2", "3", "4"].map((scene) => (
          <div className={cardBox} key={scene}>
            <div className="aspect-video skeleton" />
            <div className="h-42 sm:h-36.25" />
          </div>
        ))}
      </div>
    </>
  );
}

/** The page's title, and Rename, which turns it into a field in the same place. */
function StoryboardTitle({
  name,
  onChange,
  value,
}: {
  name: string;
  onChange: (title: string) => void;
  value: string;
}) {
  const [renaming, setRenaming] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const rename = useRef<HTMLButtonElement>(null);
  // Set when the keyboard ends a rename: focus goes back to Rename, not to the top of the page.
  const refocus = useRef(false);

  useEffect(() => {
    if (renaming) {
      field.current?.focus();
    } else if (refocus.current) {
      refocus.current = false;
      rename.current?.focus();
    }
  }, [renaming]);

  return (
    <div className="flex min-h-12 min-w-0 items-center gap-2.5">
      {renaming ? (
        <Input
          aria-label="Title"
          maxLength={80}
          onBlur={() => setRenaming(false)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              // Else Enter goes on to press Rename, which has the focus by then.
              event.preventDefault();
              refocus.current = true;
              setRenaming(false);
            }
          }}
          placeholder={name}
          ref={field}
          value={value}
        />
      ) : (
        <>
          <h1 className="line-clamp-2 min-w-0 type-title wrap-anywhere" title={name}>
            {name}
          </h1>
          <Button
            aria-label="Rename"
            onClick={() => setRenaming(true)}
            ref={rename}
            size="icon"
            variant="ghost"
          >
            <PencilIcon strokeWidth={1.75} />
          </Button>
        </>
      )}
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

  const name = storyboardName({ character: storyboard.character, title: title.trim() || null });

  return (
    <>
      <div className={headingRow}>
        <div className={headingLead}>
          <span className="relative block h-21 w-14 shrink-0 overflow-hidden rounded-md bg-screen shadow-hairline">
            <img
              alt={characterAlt(storyboard.character)}
              className="absolute inset-0 size-full object-cover"
              src={mediaUrl(storyboard.character.image)}
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <StoryboardTitle
              name={name}
              onChange={(next) => setEdits((current) => ({ ...current, title: next }))}
              value={title}
            />
            <p
              className="line-clamp-2 type-body wrap-anywhere text-soft-foreground"
              title={storyboard.sequence}
            >
              {storyboard.sequence}
            </p>
          </div>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2.5">
          <StylePicker
            onChange={(next) => setEdits((current) => ({ ...current, style: next }))}
            value={style}
          />
          <Button disabled={!dirty || busy !== null} onClick={() => void save()} variant="outline">
            <StableText
              current={busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
              labels={["Save", "Saving…", "Saved"]}
            />
          </Button>
          <Button
            disabled={busy !== null || renderable.length === 0}
            onClick={() => void generate(renderable)}
            variant="photon"
          >
            <SparklesIcon />
            <StableText
              current={Array.isArray(busy) && busy.length > 1 ? "Starting…" : "Generate all"}
              labels={["Generate all", "Starting…"]}
            />
          </Button>
        </div>
      </div>

      <ScenesNotice
        onAccess={onAccess}
        onChange={onChange}
        refusal={refusal}
        storyboard={storyboard}
      />

      <ol aria-label="Scene cards" className={cardGrid}>
        {storyboard.cards.map((card) => (
          <SceneCard
            actions={cardActions?.(card)}
            backdrop={mediaUrl(storyboard.character.image)}
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

/**
 * The line over the cards: what was just refused, else where the scenes stand (being written by
 * the text model, or the split failed, with its retry). One line in the gap above the cards, so
 * that whatever it says moves none of them: a longer text is cut, and its `title` holds it whole.
 */
function ScenesNotice({
  onAccess,
  onChange,
  refusal: asked,
  storyboard,
}: {
  onAccess: () => void;
  onChange: () => void;
  refusal: string | null;
  storyboard: Storyboard;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryRefusal, setRetryRefusal] = useState<string | null>(null);
  const { generation, message, state } = storyboard.scenes;
  const refusal = asked ?? retryRefusal;
  const writing = state === "writing" && !refusal;
  const text = writing ? "Writing four scenes from the sequence…" : (refusal ?? message);

  const retryable =
    state === "failed" && (generation?.status === "failed" || generation?.status === "cancelled");

  async function retry() {
    if (!generation) {
      return;
    }

    setRetrying(true);
    setRetryRefusal(null);

    const result = await retryGeneration(generation.id);

    setRetrying(false);

    if ("data" in result) {
      onChange();
    } else if (result.refusal.reason === "access_required") {
      onAccess();
    } else {
      setRetryRefusal(result.refusal.message);
    }
  }

  return (
    <div className="-my-6 flex h-5 min-w-0 items-center gap-2 type-caption text-soft-foreground">
      {text &&
        (writing ? (
          <ClockIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
        ) : (
          <TriangleAlertIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-warning"
            strokeWidth={1.75}
          />
        ))}
      {text && (
        <p
          className={cn("min-w-0 truncate", refusal && "text-destructive-foreground")}
          role={writing ? "status" : "alert"}
          title={text}
        >
          {text}
        </p>
      )}
      {retryable && (
        <span className="relative z-10 -my-3 shrink-0">
          <Button disabled={retrying} onClick={() => void retry()} size="inline" variant="link">
            <StableText
              current={retrying ? "Retrying…" : "Split again"}
              labels={["Split again", "Retrying…"]}
            />
          </Button>
        </span>
      )}
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

/** What stands in a card's picture while it has none: a line, over the blurred character. */
function SceneNotice({
  backdrop,
  children,
  icon: Icon,
  text,
  title,
  tone = "quiet",
}: {
  backdrop: string;
  children?: ReactNode;
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string; strokeWidth?: number }>;
  text?: string;
  title: string;
  tone?: "quiet" | "warning";
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-hidden p-4 text-center sm:gap-3.5">
      <img
        alt=""
        aria-hidden="true"
        className="absolute inset-0 size-full scale-120 object-cover blur-backdrop brightness-28"
        src={backdrop}
      />
      <span
        className={cn(
          "relative grid size-10 shrink-0 place-items-center rounded-full sm:size-13",
          tone === "quiet" ? "bg-foreground/10 text-foreground" : "bg-warning/14 text-warning",
        )}
      >
        <Icon aria-hidden={true} className="size-4.5 sm:size-5" strokeWidth={1.75} />
      </span>
      <div className="relative flex max-w-full min-w-0 flex-col items-center gap-1">
        <p className="max-w-full truncate type-label text-foreground sm:type-card-title">{title}</p>
        {text && (
          <p
            className="line-clamp-3 max-w-75 type-caption wrap-anywhere text-soft-foreground sm:text-sm"
            title={text}
          >
            {text}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/** A card's picture until it has one: what is happening, in the picture's box. */
function SceneStage({
  backdrop,
  generation,
  number,
  state,
  writing,
}: {
  backdrop: string;
  generation: GenerationSnapshot | null;
  number: number;
  state: CardState;
  writing: boolean;
}) {
  switch (state) {
    case "waiting":
      return (
        <SceneNotice
          backdrop={backdrop}
          icon={HourglassIcon}
          text="It starts by itself, so you can leave."
          title={generation?.position ? `In line · #${generation.position}` : "In line"}
        />
      );
    case "running":
      return (
        <SceneNotice
          backdrop={backdrop}
          icon={LoaderCircleIcon}
          title={
            generation?.progress === null || !generation
              ? "Starting…"
              : `Rendering ${generation.progress}%`
          }
        >
          <div className="relative mt-1 w-full max-w-50">
            <Progress aria-label={`Scene ${number} progress`} value={generation?.progress ?? 0} />
          </div>
        </SceneNotice>
      );
    case "failed":
      return (
        <SceneNotice
          backdrop={backdrop}
          icon={TriangleAlertIcon}
          text={generation?.error_message ?? "Try again, or change the scene."}
          title="This scene didn't finish"
          tone="warning"
        />
      );
    case "unknown":
      return (
        <SceneNotice
          backdrop={backdrop}
          icon={HelpCircleIcon}
          text="Comfy may have accepted this scene before its job was saved. Check the rendering backend before rendering it again."
          title="This scene may still be rendering"
          tone="warning"
        />
      );
    default:
      return (
        <div className="absolute inset-x-7 top-11 bottom-7 grid place-items-center rounded-field border border-dashed border-edge-strong p-2 text-center">
          <span className="type-caption text-muted-foreground">
            {writing ? "Writing this scene…" : "No image yet"}
          </span>
        </div>
      );
  }
}

const generateLabels = ["Generate", "Regenerate", "Try again", "Starting…"];

/** One scene card: its image or what stands in for it, its description, and its own actions. */
function SceneCard({
  actions,
  backdrop,
  busy,
  card,
  description,
  onDescription,
  onGenerate,
  starting,
  writing,
}: {
  actions: ReactNode;
  backdrop: string;
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
  const verb = state === "empty" ? "Generate" : state === "failed" ? "Try again" : "Regenerate";

  return (
    <li aria-label={`Scene ${number}: ${stateLabels[state]}`} className={cardBox}>
      <div className="relative aspect-video overflow-hidden bg-screen">
        {state === "done" && asset ? (
          <>
            <img
              alt={`${GENERATED_IMAGE_ALT} (scene ${number})`}
              className="absolute inset-0 size-full object-cover object-top"
              src={mediaUrl(asset)}
            />
            <span className={cn(pictureTag, "top-2 left-2 type-tag")}>AI-generated</span>
          </>
        ) : (
          <SceneStage
            backdrop={backdrop}
            generation={generation}
            number={number}
            state={state}
            writing={writing}
          />
        )}
        <span className={cn(pictureTag, "top-2 right-2 flex px-2")}>
          <Hud tone="foreground">Scene {number}</Hud>
        </span>
        {card.attempt > 0 && (
          <span className={cn(pictureTag, "bottom-2 left-2 type-tag")}>
            Attempt {card.attempt + 1}
            <span className="sr-only">: rendered again after a failure.</span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5 p-3.5">
        {/* Whole lines in a box of its own: the shared Textarea grows with its text, this one keeps
            the card's height, and scrolls without a cut line showing in its padding. */}
        <label className="block rounded-field border border-transparent px-2.5 py-2 transition not-has-disabled:hover:border-input has-focus-visible:border-brand has-focus-visible:bg-field has-focus-visible:ring-4 has-focus-visible:ring-brand/20">
          <span className="sr-only">Scene {number} description</span>
          <textarea
            className="block h-17 w-full resize-none overflow-y-auto bg-transparent type-body wrap-anywhere text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:text-muted-foreground sm:h-11.25"
            disabled={writing}
            id={`scene-${card.position}`}
            maxLength={1000}
            // Out of the field, the card reads from the start of its text again.
            onBlur={(event) => event.currentTarget.scrollTo({ top: 0 })}
            onChange={(event) => onDescription(event.target.value)}
            placeholder={writing ? "Writing…" : "What the character does, where, and the framing."}
            value={description}
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            aria-label={`${verb} scene ${number}`}
            disabled={busy || onWay || writing || !description.trim()}
            onClick={onGenerate}
            size="sm"
            variant={state === "empty" ? "outline" : "ghost"}
          >
            {state === "empty" ? <SparklesIcon /> : <RefreshCwIcon />}
            <StableText
              className="justify-items-start"
              current={starting ? "Starting…" : verb}
              labels={generateLabels}
            />
          </Button>
          {state === "done" && asset && generation && (
            <div aria-label={`Scene ${number} actions`} className="flex gap-1.5" role="group">
              <Button aria-label="Download" asChild size="icon" title="Download" variant="outline">
                <a download href={`${mediaUrl(asset)}?download=1`}>
                  <DownloadIcon strokeWidth={1.75} />
                </a>
              </Button>
              {actions}
              <Button aria-label="Open" asChild size="icon" title="Open" variant="outline">
                <Link params={{ generationId: generation.id }} to="/g/$generationId">
                  <MaximizeIcon strokeWidth={1.75} />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
