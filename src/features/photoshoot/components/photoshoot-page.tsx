import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, BookmarkPlusIcon, DownloadIcon, RotateCwIcon } from "lucide-react";
import { type ComponentType, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Progress } from "#/components/ui/progress";
import {
  PhotoshootShell,
  usePhotoshootRead,
} from "#/features/photoshoot/components/photoshoot-shell";
import { characterLabel } from "#/features/photoshoot/components/photoshoot-studio";
import type { Photoshoot, PhotoshootItem } from "#/features/photoshoot/contracts";
import { fetchPhotoshoot, retryShot, saveResult } from "#/features/photoshoot/photoshoot-client";
import { photoshootSetting } from "#/features/photoshoot/settings";
import { Hud } from "#/shared/components/brand";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { mediaUrl } from "#/shared/media";
import { isFinished } from "#/shared/use-live-generation";

type PageData = { photoshoot: Photoshoot };

/** What the composition's actions on a done shot (Animate) get: the generation and its output. */
type ShotActionsProps = { generationId: string; output: string };

function statusLine({ generation }: PhotoshootItem) {
  switch (generation.status) {
    case "waiting":
      return generation.position ? `Waiting in line (${generation.position})` : "Waiting in line";
    case "preparing":
    case "queued":
      return "Starting…";
    case "running":
      return `Rendering ${generation.progress ?? 0}%`;
    case "finalizing":
      return "Saving the image…";
    case "unknown":
      return "Comfy may still have this shot; it is never sent twice.";
    default:
      return generation.error_message ?? "This shot failed.";
  }
}

/**
 * One shot's result: the image when it is done (disclosed as AI-generated) with its actions (and
 * the composition's `actions`), its progress while it renders, a Retry (the shared one, a new
 * seed) when it failed.
 */
function ShotCard({
  actions: Actions,
  item,
  label,
  onChanged,
  photoshootId,
}: {
  actions?: ComponentType<ShotActionsProps>;
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

  return (
    <li className="flex flex-col gap-3 rounded-2xl border p-3" data-testid="photoshoot-shot">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {item.position + 1}. {label}
        </span>
        {item.attempt > 0 && <Badge>Attempt {item.attempt + 1}</Badge>}
      </div>
      {image && "asset" in image ? (
        <div className="relative">
          <img
            alt={GENERATED_IMAGE_ALT}
            className="w-full rounded-xl border bg-screen"
            height={image.asset.height ?? undefined}
            src={mediaUrl(image.asset)}
            width={image.asset.width ?? undefined}
          />
          <span className="absolute top-2.5 left-2.5">
            <Badge variant="solid">AI-generated image</Badge>
          </span>
        </div>
      ) : (
        <div className="grid aspect-4/7 place-items-center rounded-xl border bg-screen p-4 text-center">
          <div className="flex w-full flex-col items-center gap-3">
            <p
              className={
                generation.status === "failed"
                  ? "text-sm text-destructive-foreground"
                  : "text-sm text-soft-foreground"
              }
              role="status"
            >
              {statusLine(item)}
            </p>
            {generation.status === "running" && (
              <Progress aria-label={`Shot ${item.position + 1}`} value={generation.progress ?? 0} />
            )}
          </div>
        </div>
      )}
      {/* The result's actions. Other features' actions on a done image (such as Animate) go here. */}
      <div className="flex flex-wrap gap-2" data-testid="photoshoot-shot-actions">
        {image && "asset" in image && (
          <>
            <Button asChild size="sm" variant="outline">
              <a download href={`${mediaUrl(image.asset)}?download=1`}>
                <DownloadIcon />
                Download
              </a>
            </Button>
            {saved ? (
              <Button asChild size="sm" variant="ghost">
                <a href="/characters">Saved to library</a>
              </Button>
            ) : (
              <Button
                disabled={busy !== null}
                onClick={() => void act("save")}
                size="sm"
                variant="outline"
              >
                <BookmarkPlusIcon />
                {busy === "save" ? "Saving…" : "Save to library"}
              </Button>
            )}
            <Button asChild size="sm" variant="ghost">
              <a href={`/g/${generation.id}`}>Open</a>
            </Button>
            {Actions && <Actions generationId={generation.id} output={image.name} />}
          </>
        )}
        {(generation.status === "failed" || generation.status === "cancelled") && (
          <Button
            disabled={busy !== null}
            onClick={() => void act("retry")}
            size="sm"
            variant="outline"
          >
            <RotateCwIcon />
            {busy === "retry" ? "Retrying…" : "Retry"}
          </Button>
        )}
      </div>
      {error && (
        <p className="text-sm text-destructive-foreground" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * `/photoshoot/:id`: a photoshoot's four shots side by side, read again until every one is
 * finished (the server renders them with no browser open, so a reload shows them as they stand).
 * `shotActions` (from the composition) adds actions to each done shot, such as Animate.
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
      loaded={loaded}
      locked="Enter the access code to see this photoshoot."
      waiting="Loading the photoshoot…"
    >
      <div>
        <Button asChild size="sm" variant="ghost">
          <Link to="/photoshoot">
            <ArrowLeftIcon />
            New photoshoot
          </Link>
        </Button>
      </div>
      {photoshoot && setting && (
        <>
          <div className="flex flex-wrap items-center gap-5">
            {photoshoot.character && (
              <img
                alt={characterLabel(photoshoot.character)}
                className="h-24 w-18 rounded-xl border object-cover"
                src={mediaUrl(photoshoot.character.image)}
              />
            )}
            <div className="flex flex-col gap-2">
              <Hud>Photoshoot · {setting.title}</Hud>
              <h1 className="font-display text-3xl leading-none font-bold tracking-display sm:text-4xl">
                {photoshoot.character ? characterLabel(photoshoot.character) : "Character"} ·{" "}
                {setting.title}
              </h1>
              <time className="text-sm text-muted-foreground" dateTime={photoshoot.created_at}>
                {new Date(photoshoot.created_at).toLocaleString()}
              </time>
            </div>
          </div>
          <ul aria-label="Results" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {photoshoot.items.map((item) => (
              <ShotCard
                actions={shotActions}
                item={item}
                key={item.position}
                label={setting.shots[item.position]?.label ?? `Shot ${item.position + 1}`}
                onChanged={reload}
                photoshootId={photoshoot.id}
              />
            ))}
          </ul>
        </>
      )}
    </PhotoshootShell>
  );
}
