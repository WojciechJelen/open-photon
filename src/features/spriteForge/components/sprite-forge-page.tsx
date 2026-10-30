import { Link, useNavigate } from "@tanstack/react-router";
import { SparklesIcon, UserIcon } from "lucide-react";
import { type ComponentType, useEffect, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import type { PickableCharacter } from "#/features/characters";
import { type CharacterPickerProps, snapshotDraft } from "#/features/motionTransfer/api";
import previewHd from "#/features/spriteForge/assets/preview-hd.webp";
import previewPixel from "#/features/spriteForge/assets/preview-pixel.webp";
import { GraphPaper } from "#/features/spriteForge/components/graph-paper";
import { spriteDirections, type SpriteSetList } from "#/features/spriteForge/contracts";
import { fetchSpriteSets, postSpriteSet } from "#/features/spriteForge/sprite-client";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { Hud } from "#/shared/components/brand";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { PageHeading } from "#/shared/components/page-heading";
import { Panel } from "#/shared/components/panel";
import { SitePage } from "#/shared/components/site";
import { StableText } from "#/shared/components/stable-text";
import { SummaryRow } from "#/shared/components/summary-panel";
import { ToolColumns, ToolSection } from "#/shared/components/tool-layout";
import { mediaUrl } from "#/shared/media";
import { type HoldForCode, useAccessCode } from "#/shared/use-access-code";

// The picker's links carry no Motion Transfer shot from here.
const emptyShot = snapshotDraft({});

type RecentSet = SpriteSetList["sets"][number];

/** A listed set's progress in words: its views, then its last sheet unless the badge says it. */
function progressOf(set: RecentSet) {
  const done = set.views.filter((view) => view.status === "done").length;
  const views = `${done} of ${spriteDirections.length} directions`;

  return set.sheet_status && set.sheet_status !== "done"
    ? `${views} · last sheet ${set.sheet_status}`
    : views;
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
    // Beside the aside on a wide screen this stays in the form's column: 340 of aside + 40 of gap.
    <div className="lg:pr-95">
      <ToolSection title="Earlier sprite sets">
        <ul className="grid grid-fill-80 gap-2.5">
          {sets.map((set) => {
            const name =
              set.character?.title ??
              (set.character?.origin === "upload" ? "Untitled photo" : "Untitled character");

            const progress = progressOf(set);

            return (
              <li className="min-w-0" key={set.id}>
                <Link
                  className="flex h-full min-w-0 items-center gap-3.5 rounded-xl border bg-card/72 py-2.5 pr-4 pl-2.5 transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  params={{ spriteSetId: set.id }}
                  to="/sprites/$spriteSetId"
                >
                  <span className="relative block h-14 w-11 shrink-0 overflow-hidden rounded-thumb bg-screen shadow-hairline">
                    {set.character && (
                      <img
                        alt=""
                        className="absolute inset-0 size-full object-cover"
                        src={mediaUrl(set.character.image)}
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex min-w-0 grow basis-32 flex-col gap-0.5">
                      <span className="truncate type-label" title={name}>
                        {name}
                      </span>
                      <span
                        className="truncate type-caption text-muted-foreground"
                        title={progress}
                      >
                        {progress}
                      </span>
                    </span>
                    {set.sheet_status === "done" && <Badge variant="brand">Sheet ready</Badge>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </ToolSection>
    </div>
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
 * What a sprite comes out as: frames of a real sheet (the sample character Kenji's, HD and pixel
 * art). It shows what the tool makes, not the picked character.
 */
function SpritePreview() {
  return (
    <div
      aria-label={`A pixel-art preview of the walk cycle, ${GENERATED_IMAGE_ALT}`}
      className="relative flex h-37 items-center justify-center gap-3 overflow-hidden rounded-lg bg-field"
      role="img"
    >
      <GraphPaper cell={24} />
      <img alt="" className="relative h-30 w-24" height={160} src={previewHd} width={128} />
      <img
        alt=""
        className="relative h-30 w-24 pixelated"
        height={60}
        src={previewPixel}
        width={48}
      />
    </div>
  );
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
  characterPicker: ComponentType<CharacterPickerProps & { number?: string }>;
  onPick: (characterId: string | undefined) => void;
  selection: {
    character: PickableCharacter | null;
    characters: PickableCharacter[];
    signedIn: boolean;
  };
}) {
  const access = useAccessCode();
  const { draw, forget, pending, problem } = useSpriteSetDraw(characterId, access.hold);
  const { character } = selection;

  return (
    <SitePage category="Image" gap={10} onAccess={access.unlock} top={10}>
      <ToolColumns
        aside={
          <Panel className="gap-4 p-5">
            <SpritePreview />
            <Hud tone="soft">Your sprite</Hud>
            <div className="flex flex-col gap-3">
              <SummaryRow
                icon={<UserIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
                image={character ? mediaUrl(character.image) : undefined}
                label="Character"
                placeholder="Pick a character"
                value={character && (character.title ?? "Your character")}
              />
              <SummaryRow
                image={previewHd}
                label="You get"
                value="8 directions, HD and pixel art"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Button disabled={pending} onClick={() => void draw()} variant="photon">
                <SparklesIcon aria-hidden="true" />
                <StableText
                  current={pending ? "Starting…" : "Draw 5 directions"}
                  labels={["Draw 5 directions", "Starting…"]}
                />
              </Button>
              {/* Always there, so a refusal coming and going moves nothing below the panel. */}
              <p className="min-h-5 text-center type-caption text-pretty wrap-anywhere text-destructive-foreground">
                {problem && <span role="alert">{problem}</span>}
              </p>
            </div>
          </Panel>
        }
      >
        <PageHeading
          subtitle="Turn one character into a game-ready walk cycle."
          title="Sprite Forge"
        />
        <CharacterPicker
          character={selection.character}
          characterId={characterId}
          characters={selection.characters}
          draft={emptyShot}
          hold={access.hold}
          number="01"
          onPick={(next) => {
            forget();
            onPick(next);
          }}
          release={access.release}
          signedIn={selection.signedIn}
        />
      </ToolColumns>

      <RecentSpriteSets />

      <AccessCodeDialog {...access.dialog} />
    </SitePage>
  );
}
