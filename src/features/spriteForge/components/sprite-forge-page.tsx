import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { type ComponentType, useEffect, useId, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import type { PickableCharacter } from "#/features/characters";
import { type CharacterPickerProps, snapshotDraft } from "#/features/motionTransfer/api";
import {
  directionLabels,
  spriteDirections,
  type SpriteSetList,
} from "#/features/spriteForge/contracts";
import { fetchSpriteSets, postSpriteSet } from "#/features/spriteForge/sprite-client";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import { mediaUrl } from "#/shared/media";
import { type HoldForCode, useAccessCode } from "#/shared/use-access-code";

// The picker's links carry no Motion Transfer shot from here.
const emptyShot = snapshotDraft({});

type RecentSet = SpriteSetList["sets"][number];

/** A listed set's progress in words: its views, then its last sheet when it has one. */
function progressOf(set: RecentSet) {
  const done = set.views.filter((view) => view.status === "done").length;
  const views = `${done} of ${spriteDirections.length} directions`;

  return set.sheet_status ? `${views} · last sheet ${set.sheet_status}` : views;
}

/** The workspace's latest sprite sets, each a link to its page; nothing while there are none. */
function RecentSpriteSets() {
  const [sets, setSets] = useState<RecentSet[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    void fetchSpriteSets(controller.signal).then((result) => {
      if (!controller.signal.aborted && "data" in result) {
        setSets(result.data.sets);
      }
    });

    return () => controller.abort();
  }, []);

  if (sets.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="recent-sprite-sets" className="flex flex-col gap-3 lg:col-span-full">
      <h2 className="font-display text-2xl font-semibold" id="recent-sprite-sets">
        Recent sprite sets
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sets.map((set) => (
          <li key={set.id}>
            <Link
              className="flex h-full items-center gap-3 rounded-xl border p-3 hover:bg-foreground/4"
              params={{ spriteSetId: set.id }}
              to="/sprites/$spriteSetId"
            >
              {set.character ? (
                <img
                  alt=""
                  className="h-16 w-12 shrink-0 rounded-md border object-cover"
                  src={mediaUrl(set.character.image)}
                />
              ) : null}
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="truncate font-medium">
                  {set.character?.title ?? "Untitled character"}
                </span>
                <span className="text-xs text-muted-foreground">{progressOf(set)}</span>
                {set.sheet_status === "done" && <Badge variant="brand">Sheet ready</Badge>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Drawing a character's five directions as one sprite set (`POST /api/sprite-sets`), then opening
 * it at `/sprites/:id`. One request key per request, so a lost answer or a second click admits
 * the set once; `forget` drops the key and the problem when the character changes.
 */
function useSpriteSetDraw(characterId: string | undefined, hold: HoldForCode) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // One key per request: kept until the set is admitted, so drawing again is the same request.
  const requestKey = useRef<string | null>(null);

  async function draw() {
    if (!characterId) {
      setProblem("Pick a character first.");

      return;
    }

    requestKey.current ??= crypto.randomUUID();
    setPending(true);
    setProblem(null);

    const result = await postSpriteSet(characterId, requestKey.current);

    setPending(false);

    if ("data" in result) {
      requestKey.current = null;
      void navigate({ params: { spriteSetId: result.data.id }, to: "/sprites/$spriteSetId" });
    } else if (result.refusal.reason === "access_required") {
      hold("sprites-draw", "generate", () => void draw());
    } else {
      setProblem(result.refusal.message);
    }
  }

  function forget() {
    requestKey.current = null;
    setProblem(null);
  }

  return { draw, forget, pending, problem };
}

/**
 * Sprite Forge at `/sprites`: the character picker (the composer's `characterPicker`) beside the
 * draw panel, whose "Draw 5 directions" admits the front, three-quarter, side, back three-quarter
 * and back views as one sprite set and opens it at `/sprites/:id`, where its sheets are forged;
 * then the workspace's recent sets. The picked character lives in the URL (`characterId`,
 * changed through `onPick`).
 */
export function SpriteForgePage({
  characterId,
  characterPicker: CharacterPicker,
  onPick,
  selection,
}: {
  characterId: string | undefined;
  characterPicker: ComponentType<CharacterPickerProps>;
  onPick: (characterId: string | undefined) => void;
  selection: {
    character: PickableCharacter | null;
    characters: PickableCharacter[];
    signedIn: boolean;
  };
}) {
  const id = useId();
  const access = useAccessCode();
  const { draw, forget, pending, problem } = useSpriteSetDraw(characterId, access.hold);

  return (
    <div className="relative isolate min-h-svh">
      <PageGlow />
      <SiteHeader category="Image">
        <AccessStatus onOpen={access.unlock} signedIn={selection.signedIn} />
      </SiteHeader>
      <main className="mx-auto grid w-full max-w-330 gap-10 px-4 py-8 sm:px-8 sm:py-12 lg:grid-cols-12">
        <div className="flex flex-col gap-3 lg:col-span-full">
          <Hud>Sprite Forge · Multiple-Angles LoRA · Wan 2.2 · Sprite Forge nodes</Hud>
          <h1 className="font-display text-4xl leading-none font-bold tracking-display sm:text-5xl">
            Sprite Forge
          </h1>
          <p className="max-w-2xl text-soft-foreground">
            Turn one character into a game-ready walk cycle: five direction views first, then a
            sprite sheet with all eight directions walking.
          </p>
        </div>

        <section
          aria-labelledby={`${id}-character`}
          className="flex min-w-0 flex-col gap-4 lg:col-span-8"
        >
          <h2 className="font-display text-2xl font-semibold" id={`${id}-character`}>
            1 · Pick a character
          </h2>
          <p className="text-sm text-soft-foreground">
            A full-body image standing on its own walks best. Pick a sample, one from the library,
            or upload a photo you have the right to use.
          </p>
          <CharacterPicker
            character={selection.character}
            characterId={characterId}
            characters={selection.characters}
            draft={emptyShot}
            hold={access.hold}
            onPick={(next) => {
              forget();
              onPick(next);
            }}
            release={access.release}
            signedIn={selection.signedIn}
          />
        </section>

        <section
          aria-labelledby={`${id}-directions`}
          className="flex flex-col gap-4 rounded-2xl border p-5 lg:col-span-4 lg:self-start"
        >
          <h2 className="font-display text-2xl font-semibold" id={`${id}-directions`}>
            2 · Draw the directions
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-soft-foreground">
            <li>
              {spriteDirections.map((direction) => directionLabels[direction]).join(", ")}: each is
              its own generation with one seed for the set.
            </li>
            <li>
              On the set&apos;s page you confirm which way the turned views face and forge the
              sheet; the east side mirrors them.
            </li>
            <li>The sheet is an HD and a pixel-art atlas, each with Aseprite JSON.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-4">
            <Button disabled={pending} onClick={() => void draw()} size="lg" variant="photon">
              {pending ? "Starting…" : "Draw 5 directions"}
              <ArrowRightIcon />
            </Button>
            {problem && (
              <p className="text-sm text-destructive-foreground" role="alert">
                {problem}
              </p>
            )}
          </div>
        </section>

        <RecentSpriteSets />
      </main>
      <AccessCodeDialog {...access.dialog} />
    </div>
  );
}
