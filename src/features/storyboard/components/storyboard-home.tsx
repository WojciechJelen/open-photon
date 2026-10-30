import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { PaletteIcon, SparklesIcon, TriangleAlertIcon, UserIcon } from "lucide-react";
import {
  type ComponentType,
  type FormEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import type { PickableCharacter } from "#/features/characters";
import { type CharacterPickerProps, snapshotDraft } from "#/features/motionTransfer/api";
import {
  StoryboardFrame,
  useStoryboardRead,
} from "#/features/storyboard/components/storyboard-frame";
import { StylePicker, styleLabels } from "#/features/storyboard/components/style-picker";
import {
  CARD_COUNT,
  type StoryboardList,
  type StoryboardStyle,
} from "#/features/storyboard/contracts";
import { characterName, storyboardName } from "#/features/storyboard/names";
import { fetchStoryboards, postStoryboard } from "#/features/storyboard/storyboard-client";
import { PageHeading } from "#/shared/components/page-heading";
import { StableText } from "#/shared/components/stable-text";
import { SummaryPanel, SummaryRow } from "#/shared/components/summary-panel";
import { ToolColumns, ToolSection } from "#/shared/components/tool-layout";
import { mediaUrl } from "#/shared/media";
import type { HoldForCode } from "#/shared/use-access-code";
import { dayAndTime } from "#/shared/when";

// The picker's links carry no Motion Transfer shot from here.
const noShot = snapshotDraft({});

type SceneSource = "model" | "manual";

// The statuses of a card that will not get its image unless it is rendered again.
const stopped = new Set<string | null | undefined>(["failed", "cancelled", "unknown"]);

const emptyScenes = () => Array.from({ length: CARD_COUNT }, () => "");

/**
 * `/storyboards`: a new storyboard (a library character, from the composition's `characterPicker`,
 * a short sequence, a style, and either the text model's four scenes or four written by hand), and
 * the workspace's storyboards, most recently changed first, each linking to its page. One workspace
 * per installation. `characters` comes with the page, so the form is whole at first paint; only the
 * list is read after it (`null` until then).
 */
export function StoryboardHome({
  characterPicker,
  characters,
}: {
  characterPicker: ComponentType<CharacterPickerProps & { number?: string }>;
  characters: PickableCharacter[];
}) {
  const router = useRouter();

  const { reload, state } = useStoryboardRead<StoryboardList | null>(
    fetchStoryboards,
    () => false,
    null,
  );

  const readAgain = useCallback(() => {
    reload();
    void router.invalidate();
  }, [reload, router]);

  return (
    <StoryboardFrame
      gap={10}
      holdKey="storyboards"
      noun="storyboards"
      reload={readAgain}
      state={state}
      top={10}
    >
      {(list, askForCode, { hold, release }) => (
        <>
          <NewStoryboard
            characterPicker={characterPicker}
            characters={characters}
            hold={hold}
            onAccess={askForCode}
            onUploaded={() => void router.invalidate()}
            release={release}
          />
          <StoryboardIndex list={list} />
        </>
      )}
    </StoryboardFrame>
  );
}

/** A labelled row of the style section: the word, then its segmented choice. */
function Setting({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span aria-hidden="true" className="w-16 type-caption font-medium text-soft-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/** "Your storyboard": what the form has picked so far, and the action that creates it. */
function StoryboardSummary({
  busy,
  character,
  look,
  ready,
  refusal,
}: {
  busy: boolean;
  character?: PickableCharacter;
  look: StoryboardStyle | null;
  ready: boolean;
  refusal: string | null;
}) {
  return (
    <SummaryPanel
      actions={
        <Button disabled={!ready || busy} type="submit" variant="photon">
          <SparklesIcon />
          <StableText
            current={busy ? "Creating…" : "Create storyboard"}
            labels={["Create storyboard", "Creating…"]}
          />
        </Button>
      }
      label="Your storyboard"
      note={
        refusal ? (
          <span className="text-destructive-foreground" role="alert">
            {refusal}
          </span>
        ) : (
          "You can edit every scene before it renders."
        )
      }
    >
      <SummaryRow
        icon={<UserIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
        image={character && mediaUrl(character.image)}
        label="Character"
        placeholder="Pick a character"
        value={character && characterName(character)}
      />
      <SummaryRow
        icon={<PaletteIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
        label="Look"
        media={
          look && (
            <span className="absolute inset-0 grid place-items-center text-soft-foreground">
              <PaletteIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </span>
          )
        }
        placeholder="Pick a look"
        value={look && styleLabels[look]}
      />
    </SummaryPanel>
  );
}

function NewStoryboard({
  characterPicker: CharacterPicker,
  characters,
  hold,
  onAccess,
  onUploaded,
  release,
}: {
  characterPicker: ComponentType<CharacterPickerProps & { number?: string }>;
  characters: PickableCharacter[];
  hold: HoldForCode;
  onAccess: () => void;
  onUploaded: () => void;
  release: (key: string) => void;
}) {
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string | null>(characters[0]?.id ?? null);
  // A new upload takes over from the pick once the list holds it: until then the picker would call
  // it a character this visitor may not see, and the summary would have nothing to show.
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [sequence, setSequence] = useState("");
  const [title, setTitle] = useState("");
  // No default: naming the style keeps the four cards in one look (an unnamed one drifted on Cloud).
  const [style, setStyle] = useState<StoryboardStyle | null>(null);
  const [source, setSource] = useState<SceneSource>("model");
  const [scenes, setScenes] = useState(emptyScenes);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // One key per storyboard asked for: kept until an answer comes, so sending again after a lost
  // answer finds the storyboard the first request made.
  const requestKey = useRef<string | null>(null);
  const characterId = characters.some(({ id }) => id === uploaded) ? uploaded : picked;

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!characterId || !style) {
      return;
    }

    setBusy(true);
    setRefusal(null);
    requestKey.current ??= crypto.randomUUID();

    const result = await postStoryboard(
      {
        character_id: characterId,
        scenes: source === "manual" ? scenes : undefined,
        sequence,
        style,
        title,
      },
      requestKey.current,
    );

    setBusy(false);

    if ("data" in result) {
      requestKey.current = null;
      void navigate({ params: { storyboardId: result.data.id }, to: "/storyboards/$storyboardId" });

      return;
    }

    // An answer that came back refused cannot change on its own: the next try is a new request.
    if (result.refusal.reason !== undefined) {
      requestKey.current = null;
    }

    if (result.refusal.reason === "access_required") {
      onAccess();
    } else {
      setRefusal(result.refusal.message);
    }
  }

  const character = characters.find(({ id }) => id === characterId);

  const ready =
    characterId !== null &&
    // While an upload reaches the list the pick is still the one before it: not what was meant.
    (uploaded === null || uploaded === characterId) &&
    style !== null &&
    sequence.trim() !== "" &&
    (source === "model" || scenes.every((scene) => scene.trim() !== ""));

  return (
    <form aria-label="New storyboard" onSubmit={(event) => void submit(event)}>
      <ToolColumns
        aside={
          <StoryboardSummary
            busy={busy}
            character={character}
            look={style}
            ready={ready}
            refusal={refusal}
          />
        }
        asideClassName="sticky top-6"
      >
        <PageHeading subtitle="Four scenes of one character, ready to edit." title="Storyboards" />

        <CharacterPicker
          character={character ?? null}
          characterId={characterId ?? undefined}
          characters={characters}
          draft={noShot}
          hold={hold}
          number="01"
          onPick={(next) => {
            // The tile picked stays picked: a storyboard always needs a character.
            if (!next) {
              return;
            }

            if (characters.some(({ id }) => id === next)) {
              setPicked(next);
              setUploaded(null);
            } else {
              setUploaded(next);
              onUploaded();
            }
          }}
          release={release}
          signedIn
        />

        <ToolSection number="02" title="Sequence">
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="storyboard-sequence">What happens</Label>
            <Textarea
              id="storyboard-sequence"
              maxLength={1000}
              onChange={(event) => setSequence(event.target.value)}
              placeholder="Maya arrives on an empty rooftop at sunset, stretches, breakdances as the city lights come on, then sits on the ledge looking at the skyline."
              rows={3}
              value={sequence}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="storyboard-title">Title</Label>
            <Input
              id="storyboard-title"
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Optional"
              value={title}
            />
          </div>
        </ToolSection>

        <ToolSection number="03" title="Style">
          <Setting label="Look">
            <StylePicker onChange={setStyle} value={style} />
          </Setting>
          <Setting label="Scenes">
            <ToggleGroup
              aria-label="Scenes"
              onValueChange={(value) => {
                if (value === "model" || value === "manual") {
                  setSource(value);
                }
              }}
              spacing={1}
              type="single"
              value={source}
              variant="segmented"
            >
              <ToggleGroupItem value="model">Split it for me</ToggleGroupItem>
              <ToggleGroupItem value="manual">I'll write four</ToggleGroupItem>
            </ToggleGroup>
          </Setting>
          {source === "manual" && (
            <ol className="grid gap-3 sm:grid-cols-2">
              {scenes.map((scene, position) => (
                // The four places are fixed, so the position is the scene's identity.
                // oxlint-disable-next-line react/no-array-index-key
                <li className="flex min-w-0 flex-col gap-2" key={position}>
                  <Label htmlFor={`new-scene-${position}`}>Scene {position + 1}</Label>
                  <Textarea
                    id={`new-scene-${position}`}
                    maxLength={1000}
                    onChange={(event) =>
                      setScenes((current) =>
                        current.map((text, index) =>
                          index === position ? event.target.value : text,
                        ),
                      )
                    }
                    placeholder="What the character does, where, and the framing."
                    rows={3}
                    value={scene}
                  />
                </li>
              ))}
            </ol>
          )}
        </ToolSection>
      </ToolColumns>
    </form>
  );
}

/** One storyboard in the list: its four scenes small, its name and when it last changed. */
function StoryboardTile({ storyboard }: { storyboard: StoryboardList["storyboards"][number] }) {
  const name = storyboardName(storyboard);
  const done = storyboard.images.filter((image) => image !== null).length;
  const failed = storyboard.statuses.filter((status) => stopped.has(status)).length;

  return (
    <Link
      className="flex min-w-0 items-center gap-3.5 rounded-xl border bg-card/72 py-2.5 pr-4 pl-2.5 transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      params={{ storyboardId: storyboard.id }}
      to="/storyboards/$storyboardId"
    >
      <span
        aria-label={`${done} of ${CARD_COUNT} rendered${failed > 0 ? `, ${failed} failed` : ""}${done > 0 ? ", AI-generated images" : ""}`}
        className="relative flex shrink-0 gap-0.75"
        role="img"
      >
        {storyboard.images.map((image, position) => (
          // The four places are fixed, so the position is the scene's identity.
          // oxlint-disable-next-line react/no-array-index-key
          <span
            className="relative grid h-14 w-9.5 place-items-center overflow-hidden rounded-sm bg-screen text-warning"
            key={position}
          >
            {image ? (
              <img
                alt=""
                className="absolute inset-0 size-full object-cover"
                loading="lazy"
                src={mediaUrl(image)}
              />
            ) : (
              stopped.has(storyboard.statuses[position]) && (
                <TriangleAlertIcon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              )
            )}
          </span>
        ))}
        {done > 0 && (
          <span className="absolute bottom-1 left-1 rounded-tag bg-background/66 px-1.75 py-0.75 type-tag text-foreground">
            AI-generated
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate type-label text-foreground" title={name}>
          {name}
        </span>
        <time
          className="truncate type-caption text-muted-foreground"
          dateTime={storyboard.updated_at}
        >
          {dayAndTime(storyboard.updated_at)}
        </time>
      </span>
    </Link>
  );
}

function StoryboardIndex({ list }: { list: StoryboardList | null }) {
  return (
    // Below the summary on a phone, so that a long list never parts the form from Create. Wide, it
    // stays in the form's column (340 of aside + 40 of gap), a section's 36 under the last one.
    <div className="-mt-1 lg:pr-95">
      <ToolSection title="Your storyboards">
        {list === null && (
          <>
            <p className="sr-only" role="status">
              Loading storyboards…
            </p>
            <div aria-hidden="true" className="grid grid-fill-80 gap-2.5">
              {["first", "second"].map((tile) => (
                <div className="h-19.5 skeleton rounded-xl" key={tile} />
              ))}
            </div>
          </>
        )}
        {list?.storyboards.length === 0 && (
          <p className="type-caption text-muted-foreground">No storyboards yet.</p>
        )}
        {list && list.storyboards.length > 0 && (
          <ul className="grid grid-fill-80 gap-2.5">
            {list.storyboards.map((storyboard) => (
              <li className="min-w-0" key={storyboard.id}>
                <StoryboardTile storyboard={storyboard} />
              </li>
            ))}
          </ul>
        )}
      </ToolSection>
    </div>
  );
}
