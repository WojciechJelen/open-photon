import { Link } from "@tanstack/react-router";
import {
  DownloadIcon,
  HourglassIcon,
  MaximizeIcon,
  PlusIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";

import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import {
  PhotoshootShell,
  usePhotoshootRead,
} from "#/features/photoshoot/components/photoshoot-shell";
import type { Photoshoot, PhotoshootItem } from "#/features/photoshoot/contracts";
import { photoshootTitle } from "#/features/photoshoot/labels";
import { fetchPhotoshoot, retryShot, saveResult } from "#/features/photoshoot/photoshoot-client";
import { photoshootSetting, SHOTS_PER_SESSION } from "#/features/photoshoot/settings";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { PageHeading } from "#/shared/components/page-heading";
import { ResultFigure, SaveToLibrary } from "#/shared/components/result-figure";
import { StableText } from "#/shared/components/stable-text";
import { StateCard } from "#/shared/components/state-card";
import { mediaUrl } from "#/shared/media";
import { isFinished } from "#/shared/use-live-generation";
import { dayAndTime } from "#/shared/when";

type PageData = { photoshoot: Photoshoot };

/** What the composition's actions on a done shot (Animate) get: the generation and its output. */
type ShotActionsProps = { generationId: string; output: string };

// A `ResultFigure`'s box, `ShotFrame`'s too: a shot keeps it from the first read to its image.
const SHOT_ASPECT = "aspect-9/16";

// Holds a line of text's height until there is a text to put on it.
const BLANK_LINE = "\u00A0";

// `StateCard` as all of a shot's box, where it has no frame or height of its own.
const inFrame = "absolute inset-0 min-h-0 rounded-none border-0 bg-transparent p-4";

/** What a shot's box says until its image lands; two lines of text, so its stack stays put. */
function progressOf({ generation }: PhotoshootItem) {
  switch (generation.status) {
    case "waiting": {
      const ahead = generation.position ? generation.position - 1 : 0;

      return {
        text: `${ahead > 0 ? `${ahead} ahead of it. ` : ""}It starts by itself, so you can leave.`,
        title: "In line",
      };
    }

    case "preparing":
    case "queued":
      return { text: "You can leave while it renders.", title: "Starting" };
    case "running":
      return { text: `${generation.progress ?? 0}%`, title: "Rendering" };
    case "finalizing":
      return { text: "Saving the image…", title: "Finishing" };
    default:
      return null;
  }
}

/** A shot with no image: `ResultFigure`'s box and caption, without the AI-generated tag. */
function ShotFrame({
  caption,
  children,
  meta,
}: {
  caption: string;
  children?: ReactNode;
  meta?: string;
}) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2.5">
      <div className={`relative overflow-hidden rounded-field border bg-screen ${SHOT_ASPECT}`}>
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

/**
 * One shot in one box from the first read to its image, its caption under it: the image when it is
 * done (disclosed as AI-generated) with its actions on the scrim (and the composition's `actions`),
 * its progress while it renders, a Try again (the shared retry, a new seed) when it failed. A
 * refusal of an action has a line of its own, kept empty, under the caption.
 */
function ShotCard({
  actions: Actions,
  backdrop,
  item,
  label,
  onChanged,
  photoshootId,
}: {
  actions?: ComponentType<ShotActionsProps>;
  backdrop?: string;
  item: PhotoshootItem;
  label: string;
  onChanged: () => void;
  photoshootId: string;
}) {
  const { generation } = item;
  const image = generation.outputs.find((output) => output.name === "image" && "asset" in output);
  const [busy, setBusy] = useState<"retry" | "save" | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "retry" | "save") {
    setBusy(kind);
    setError(null);

    const result =
      kind === "save"
        ? await saveResult(photoshootId, generation.id)
        : await retryShot(generation.id);

    setBusy(null);

    if ("refusal" in result) {
      setError(result.refusal.message);
    } else if ("image_asset_id" in result.data) {
      setSaved(result.data.id);
    } else {
      onChanged();
    }
  }

  const attempt = item.attempt > 0 ? `Attempt ${item.attempt + 1}` : undefined;
  const progress = progressOf(item);
  const failure = generation.error_message ?? "Something stopped this shot.";

  return (
    <li className="flex min-w-0 flex-col gap-1" data-testid="photoshoot-shot">
      {image && "asset" in image ? (
        <ResultFigure
          actions={
            <>
              <Button aria-label="Download" asChild size="icon" title="Download" variant="scrim">
                <a download href={`${mediaUrl(image.asset)}?download=1`}>
                  <DownloadIcon aria-hidden="true" strokeWidth={1.75} />
                </a>
              </Button>
              <SaveToLibrary
                disabled={busy !== null}
                onSave={() => void act("save")}
                saved={saved}
                saving={busy === "save"}
              />
              {Actions && <Actions generationId={generation.id} output={image.name} />}
              <Button aria-label="Open" asChild size="icon" title="Open" variant="scrim">
                <a href={`/g/${generation.id}`}>
                  <MaximizeIcon aria-hidden="true" strokeWidth={1.75} />
                </a>
              </Button>
            </>
          }
          aspect={SHOT_ASPECT}
          caption={label}
          meta={saved ? "Saved" : attempt}
          revealActions
        >
          <img
            alt={GENERATED_IMAGE_ALT}
            className="absolute inset-0 size-full object-cover"
            src={mediaUrl(image.asset)}
          />
        </ResultFigure>
      ) : (
        <ShotFrame caption={label} meta={attempt}>
          {progress && (
            <StateCard
              backdrop={backdrop}
              className={inFrame}
              icon={HourglassIcon}
              text={
                <span className="block min-h-10" role="status">
                  {progress.text}
                </span>
              }
              title={progress.title}
              tone="quiet"
            >
              <span className="block w-50 max-w-full">
                <Progress
                  aria-label={`Shot ${item.position + 1}`}
                  value={generation.progress ?? 0}
                />
              </span>
            </StateCard>
          )}
          {generation.status === "unknown" && (
            <StateCard
              backdrop={backdrop}
              className={inFrame}
              icon={HourglassIcon}
              text={
                <span role="status">Comfy may still have this shot; it is never sent twice.</span>
              }
              title="Not sure yet"
              tone="quiet"
            />
          )}
          {(generation.status === "failed" || generation.status === "cancelled") && (
            <StateCard
              backdrop={backdrop}
              className={inFrame}
              icon={TriangleAlertIcon}
              text={
                <span className="line-clamp-4" role="status" title={failure}>
                  {failure}
                </span>
              }
              title="This shot didn't finish"
              tone="warning"
            >
              <Button disabled={busy !== null} onClick={() => void act("retry")}>
                <RotateCwIcon />
                <StableText
                  current={busy === "retry" ? "Retrying…" : "Try again"}
                  labels={["Try again", "Retrying…"]}
                />
              </Button>
            </StateCard>
          )}
        </ShotFrame>
      )}
      <p
        className="min-h-5 truncate type-caption text-destructive-foreground"
        role="alert"
        title={error ?? undefined}
      >
        {error}
      </p>
    </li>
  );
}

/**
 * `/photoshoot/:id`: a photoshoot's four shots side by side, read again until every one is
 * finished (the server renders them with no browser open, so a reload shows them as they stand).
 * `shotActions` (from the composition) adds actions to each done shot, such as Animate. Its boxes
 * are there before the first read, and one that is not there is a page of its own (the shell's).
 */
export function PhotoshootPage({
  photoshootId,
  shotActions,
}: {
  photoshootId: string;
  shotActions?: ComponentType<ShotActionsProps>;
}) {
  const { access, askForCode, loaded, reload } = usePhotoshootRead<PageData>(
    async (signal) => {
      const result = await fetchPhotoshoot(photoshootId, signal);

      return "data" in result ? { data: { photoshoot: result.data } } : result;
    },
    ({ photoshoot }) => !photoshoot.items.every((item) => isFinished(item.generation.status)),
  );

  const photoshoot = loaded.kind === "ready" ? loaded.photoshoot : null;
  const setting = photoshoot && photoshootSetting(photoshoot.setting);

  return (
    <PhotoshootShell
      access={access}
      askForCode={askForCode}
      gap={7}
      loaded={loaded}
      locked="Enter the access code to see this photoshoot."
      top={10}
      waiting="Loading the photoshoot…"
    >
      {loaded.kind !== "missing" && (
        <PageHeading
          actions={
            <Button asChild variant="outline">
              <Link to="/photoshoot">
                <PlusIcon />
                <span>New photoshoot</span>
              </Link>
            </Button>
          }
          subtitle={
            photoshoot ? (
              <time dateTime={photoshoot.created_at}>{dayAndTime(photoshoot.created_at)}</time>
            ) : (
              BLANK_LINE
            )
          }
          title={
            photoshoot ? photoshootTitle(photoshoot.character, photoshoot.setting) : "Photoshoot"
          }
        />
      )}
      {(photoshoot || loaded.kind === "loading") && (
        <ul aria-label="Results" className="grid grid-fit-60 gap-4">
          {photoshoot && setting
            ? photoshoot.items.map((item) => (
                <ShotCard
                  actions={shotActions}
                  backdrop={photoshoot.character ? mediaUrl(photoshoot.character.image) : undefined}
                  item={item}
                  key={item.position}
                  label={setting.shots[item.position]?.label ?? `Shot ${item.position + 1}`}
                  onChanged={reload}
                  photoshootId={photoshoot.id}
                />
              ))
            : Array.from({ length: SHOTS_PER_SESSION }, (_, position) => (
                <li aria-hidden="true" className="flex min-w-0 flex-col gap-1" key={position}>
                  <ShotFrame caption={BLANK_LINE} />
                  <span className="min-h-5" />
                </li>
              ))}
        </ul>
      )}
    </PhotoshootShell>
  );
}
