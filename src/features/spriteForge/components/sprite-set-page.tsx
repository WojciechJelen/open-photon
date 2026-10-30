import { Link } from "@tanstack/react-router";
import { CompassIcon, HammerIcon, LockIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Choice } from "#/features/spriteForge/components/choice";
import { SheetCard } from "#/features/spriteForge/components/sprite-sheet-card";
import { ViewCard, ViewPlaceholder } from "#/features/spriteForge/components/sprite-view-card";
import {
  defaultFacing,
  directionLabels,
  type SheetFacing,
  type SheetTakes,
  type SpriteSet,
  spriteDirections,
} from "#/features/spriteForge/contracts";
import { fetchSpriteSet, postSpriteSheet } from "#/features/spriteForge/sprite-client";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { PageHeading } from "#/shared/components/page-heading";
import { Panel } from "#/shared/components/panel";
import { SitePage } from "#/shared/components/site";
import { StateCard } from "#/shared/components/state-card";
import { ToolSection } from "#/shared/components/tool-layout";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { type HoldForCode, useAccessCode } from "#/shared/use-access-code";
import { isFinished } from "#/shared/use-live-generation";

// How often the set is read again while one of its generations is still on its way.
const REREAD_MS = 4000;

const SUBTITLE = "Check which way each side view faces, then forge the sheet.";

type Page =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; set: SpriteSet };

function pageOf(result: { data: SpriteSet } | { refusal: Refusal }): Page {
  if ("data" in result) {
    return { kind: "ready", set: result.data };
  }

  switch (result.refusal.reason) {
    case "access_required":
      return { kind: "access" };
    case "not_found":
      return { kind: "missing" };
    default:
      return { kind: "error", message: result.refusal.message };
  }
}

/**
 * `GET /api/sprite-sets/:id`, read once, on `reload`, and `REREAD_MS` after each read settles
 * while a view or a sheet is unfinished: whether every view is done decides whether a sheet can be
 * forged, and a retry's child is followed only through the set. The next re-read waits for the
 * current one, so a slow server still moves the set along. A failed re-read keeps the set on the
 * page. `show` puts a set the server just answered with in place.
 */
function useSpriteSet(id: string) {
  const [page, setPage] = useState<Page>({ kind: "loading" });
  const [reads, reload] = useReducer((count: number) => count + 1, 0);
  const [settled, settle] = useReducer((count: number) => count + 1, 0);
  const reading = useRef(false);

  const following =
    page.kind === "ready" &&
    [...page.set.views, ...page.set.sheets].some(
      ({ generation }) => !isFinished(generation.status),
    );

  useEffect(() => {
    const controller = new AbortController();

    reading.current = true;
    void fetchSpriteSet(id, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        reading.current = false;
        setPage((previous) =>
          previous.kind === "ready" && "refusal" in result ? previous : pageOf(result),
        );
        settle();
      }
    });

    return () => controller.abort();
  }, [id, reads]);

  useEffect(() => {
    if (!following) {
      return;
    }

    // A read still out (one `reload` started) schedules the next re-read when it settles.
    const timer = setTimeout(() => {
      if (!reading.current) {
        reload();
      }
    }, REREAD_MS);

    return () => clearTimeout(timer);
  }, [following, settled]);

  const show = useCallback((set: SpriteSet) => setPage({ kind: "ready", set }), []);

  return { page, reload, show };
}

/** The start of every download's name: the character's title as a slug (`maya-chen`). */
function slugOf(title: string | null | undefined) {
  const slug = (title ?? "")
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replaceAll(/^-+|-+$/g, "");

  return slug || "character";
}

const takesOptions = [
  { label: "Best of 3", value: "3" },
  { label: "Quick", value: "1" },
] as const;

/** Where a sheet's settings are chosen and it is forged; it waits for all five views. */
function ForgePanel({
  available,
  onForge,
  onTakes,
  pending,
  problem,
  ready,
  takes,
}: {
  available: boolean;
  onForge: () => void;
  onTakes: (takes: SheetTakes) => void;
  pending: boolean;
  problem: string | null;
  ready: boolean;
  takes: SheetTakes;
}) {
  return (
    <Panel
      aria-label="Forge a sprite sheet"
      className="flex-row flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4"
      role="group"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <span className="min-w-0 text-sm font-semibold wrap-anywhere">Walk quality</span>
        <Choice
          label="Walk quality"
          onChange={(value) => onTakes(value === "1" ? 1 : 3)}
          options={takesOptions}
          value={takes === 1 ? "1" : "3"}
        />
      </div>
      {/* Always there, so the line coming and going moves nothing; under the rest when it wraps. */}
      <p className="order-last min-h-5 w-full min-w-0 type-caption text-pretty wrap-anywhere text-muted-foreground lg:order-none lg:w-auto lg:grow lg:basis-60 lg:text-right">
        {problem ? (
          <span className="text-destructive-foreground" role="alert">
            {problem}
          </span>
        ) : (
          available && !ready && "Every direction must be done first; retry a failed one."
        )}
      </p>
      {/* Full width once it wraps under the choice, as a phone's main action is. */}
      <div className="flex min-w-0 grow flex-col sm:grow-0">
        <Button disabled={!available || !ready || pending} onClick={onForge} variant="photon">
          <HammerIcon aria-hidden="true" />
          Forge sprite sheet
        </Button>
      </div>
      {!available && (
        <p className="order-last w-full type-caption text-pretty text-soft-foreground">
          Sprite sheets run the Sprite Forge custom nodes, which only a self-hosted ComfyUI has.
          Point the app at your own GPU (see the self-host section of the Sprite Forge README) to
          forge one.
        </p>
      )}
    </Panel>
  );
}

/** The page's heading, the same from loading on: another set is one click away from anywhere. */
function SetHeading({ characterId, title }: { characterId?: string; title: string }) {
  return (
    <PageHeading
      actions={
        <Button asChild variant="outline">
          <Link search={{ character: characterId }} to="/sprites">
            <PlusIcon aria-hidden="true" />
            New sprite
          </Link>
        </Button>
      }
      subtitle={SUBTITLE}
      title={title}
    />
  );
}

/** A set on its way from the server, in the boxes it will take. */
function LoadingSet() {
  return (
    <>
      <SetHeading title="Sprite set" />
      <p className="sr-only" role="status">
        Loading the sprite set…
      </p>
      <div className="grid tiles-fit-48 items-start gap-3.5">
        {spriteDirections.map((direction) => (
          <ViewPlaceholder caption={directionLabels[direction]} key={direction} />
        ))}
      </div>
    </>
  );
}

/** The page while it has no set: the code needed, no such set, or a failed read. */
function Notice({
  onAccess,
  onRetry,
  page,
}: {
  onAccess: () => void;
  onRetry: () => void;
  page: Exclude<Page, { kind: "loading" | "ready" }>;
}) {
  if (page.kind === "access") {
    return (
      <StateCard
        className="min-h-120"
        heading="h1"
        icon={LockIcon}
        text="Enter the access code to see this sprite set."
        title="This needs an access code"
      >
        <Button onClick={onAccess} variant="outline">
          Enter code
        </Button>
      </StateCard>
    );
  }

  if (page.kind === "missing") {
    return (
      <StateCard
        className="min-h-120"
        heading="h1"
        icon={CompassIcon}
        text="This sprite set doesn't exist."
        title="Nothing here"
      >
        <Button asChild variant="outline">
          <Link to="/sprites">Sprite Forge</Link>
        </Button>
      </StateCard>
    );
  }

  return (
    <div className="contents" role="alert">
      <StateCard
        className="min-h-120"
        heading="h1"
        icon={TriangleAlertIcon}
        text={page.message}
        title="This sprite set didn't load"
        tone="warning"
      >
        <Button onClick={onRetry} variant="outline">
          Try again
        </Button>
      </StateCard>
    </div>
  );
}

/** A loaded set: its views with the facing of the turned ones, the forge panel and its sheets. */
function LoadedSet({
  onAccess,
  onRetried,
  onSheet,
  set,
}: {
  onAccess: HoldForCode;
  onRetried: () => void;
  onSheet: (set: SpriteSet) => void;
  set: SpriteSet;
}) {
  const [facing, setFacing] = useState<SheetFacing>(defaultFacing);
  const [takes, setTakes] = useState<SheetTakes>(3);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // One key per sheet request: kept until it is admitted, so forging again is the same request;
  // another facing or takes is another request.
  const requestKey = useRef<string | null>(null);
  const name = set.character?.title ?? "Your character";
  const slug = slugOf(set.character?.title);
  const backdrop = set.character ? mediaUrl(set.character.image) : undefined;
  const ready = set.views.every((view) => view.generation.status === "done");

  async function forge() {
    requestKey.current ??= crypto.randomUUID();
    setPending(true);
    setProblem(null);

    const result = await postSpriteSheet(set.id, { facing, takes }, requestKey.current);

    setPending(false);

    if ("data" in result) {
      requestKey.current = null;
      onSheet(result.data.set);
    } else if (result.refusal.reason === "access_required") {
      onAccess("sprite-sheet", "generate", () => void forge());
    } else {
      setProblem(result.refusal.message);
    }
  }

  return (
    <>
      <SetHeading characterId={set.character?.id} title={`${name}, five directions`} />

      <ul aria-label="Direction views" className="grid tiles-fit-48 items-start gap-3.5">
        {set.views.map((view) => {
          const { direction } = view;
          const turned = direction === "sw" || direction === "w" || direction === "nw";

          return (
            <ViewCard
              backdrop={backdrop}
              facing={turned ? facing[direction] : null}
              key={`${view.generation.id}-${view.generation.status}`}
              onAccess={onAccess}
              onFacing={(next) => {
                if (turned) {
                  requestKey.current = null;
                  setFacing((current) => ({ ...current, [direction]: next }));
                }
              }}
              onRetried={onRetried}
              view={view}
            />
          );
        })}
      </ul>

      <ForgePanel
        available={set.sheets_available}
        onForge={() => void forge()}
        onTakes={(next) => {
          requestKey.current = null;
          setTakes(next);
        }}
        pending={pending}
        problem={problem}
        ready={ready}
        takes={takes}
      />

      <ToolSection title={set.sheets.length > 1 ? "Sprite sheets" : "Sprite sheet"}>
        {set.sheets.length === 0 ? (
          <StateCard
            className="min-h-138"
            frame
            heading="h3"
            text="Check the directions, then forge it."
            title="Your sheet appears here"
          />
        ) : (
          <ul aria-label="Sprite sheets" className="flex flex-col gap-10">
            {set.sheets.map((sheet) => (
              <SheetCard
                backdrop={backdrop}
                key={`${sheet.generation.id}-${sheet.generation.status}`}
                name={name}
                onAccess={onAccess}
                onRetried={onRetried}
                sheet={sheet}
                slug={slug}
              />
            ))}
          </ul>
        )}
      </ToolSection>
    </>
  );
}

/**
 * A sprite set at `/sprites/:id`: the five direction views of its character, each following its
 * own generation (a failed one offers the shared retry; an unknown one is never retried, Comfy
 * may still be rendering it), the facing of the three turned views, the forge panel (`POST
 * /api/sprite-sets/:id/sheets` once every view is done, on a self-hosted target only) and the
 * set's sheets, most recent first, each with its downloads and the walk playground once done.
 */
export function SpriteSetPage({ spriteSetId }: { spriteSetId: string }) {
  const { page, reload, show } = useSpriteSet(spriteSetId);
  const access = useAccessCode();

  return (
    <SitePage
      category="Image"
      gap={7}
      onAccess={() => access.hold("sprite-set", "unlock", reload)}
      top={10}
    >
      {page.kind === "ready" ? (
        <LoadedSet onAccess={access.hold} onRetried={reload} onSheet={show} set={page.set} />
      ) : page.kind === "loading" ? (
        <LoadingSet />
      ) : (
        <Notice
          onAccess={() => access.hold("sprite-set", "unlock", reload)}
          onRetry={reload}
          page={page}
        />
      )}

      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}
