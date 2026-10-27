import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import type { CharacterSummary } from "#/features/characters";
import {
  StoryboardFrame,
  useStoryboardRead,
} from "#/features/storyboard/components/storyboard-frame";
import { StylePicker } from "#/features/storyboard/components/style-picker";
import {
  CARD_COUNT,
  type StoryboardList,
  type StoryboardStyle,
} from "#/features/storyboard/contracts";
import { characterAlt, characterName } from "#/features/storyboard/names";
import {
  fetchCharacters,
  fetchStoryboards,
  postStoryboard,
} from "#/features/storyboard/storyboard-client";
import { Hud } from "#/shared/components/brand";
import { mediaUrl } from "#/shared/media";

type SceneSource = "model" | "manual";

type HomeData = { characters: CharacterSummary[]; list: StoryboardList };

const emptyScenes = () => Array.from({ length: CARD_COUNT }, () => "");

/** The workspace's storyboards and the characters to start one from, read together. */
async function readHome(signal: AbortSignal) {
  const [list, characters] = await Promise.all([fetchStoryboards(signal), fetchCharacters(signal)]);

  if (!("data" in list)) {
    return list;
  }

  return "data" in characters
    ? { data: { characters: characters.data.characters, list: list.data } }
    : characters;
}

/**
 * `/storyboards`: a new storyboard (a library character, a short sequence, a style, and either
 * the text model's four scenes or four written by hand), and the workspace's storyboards, most
 * recently changed first, each linking to its page. One workspace per installation.
 */
export function StoryboardHome() {
  const { reload, state } = useStoryboardRead<HomeData>(readHome, () => false);

  return (
    <StoryboardFrame holdKey="storyboards" noun="storyboards" reload={reload} state={state}>
      {({ characters, list }, askForCode) => (
        <>
          <div className="flex flex-col gap-4">
            <Hud>Storyboard</Hud>
            <h1 className="font-display text-4xl leading-none font-bold tracking-display sm:text-5xl">
              Storyboards
            </h1>
            <p className="max-w-2xl text-soft-foreground">
              Pick a character, describe a short sequence, and get four scene cards you can edit and
              render one by one, the character kept from card to card.
            </p>
          </div>
          <NewStoryboard characters={characters} onAccess={askForCode} />
          <StoryboardIndex list={list} />
        </>
      )}
    </StoryboardFrame>
  );
}

function NewStoryboard({
  characters,
  onAccess,
}: {
  characters: CharacterSummary[];
  onAccess: () => void;
}) {
  const navigate = useNavigate();
  const [characterId, setCharacterId] = useState<string | null>(characters[0]?.id ?? null);
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

  const ready =
    characterId !== null &&
    style !== null &&
    sequence.trim() !== "" &&
    (source === "model" || scenes.every((scene) => scene.trim() !== ""));

  return (
    <form
      aria-labelledby="new-storyboard"
      className="flex flex-col gap-6 rounded-3xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-4 sm:p-6"
      onSubmit={(event) => void submit(event)}
    >
      <h2 className="font-display text-2xl font-semibold" id="new-storyboard">
        New storyboard
      </h2>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium">Character</legend>
        {characters.length === 0 ? (
          <p className="text-sm text-soft-foreground">
            The library has no characters yet.{" "}
            <Link className="underline underline-offset-3" to="/characters/new">
              Create one
            </Link>
            .
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {characters.map((character) => (
              <li key={character.id}>
                <button
                  aria-label={characterName(character)}
                  aria-pressed={character.id === characterId}
                  className="flex w-full flex-col gap-1.5 rounded-xl border p-1.5 text-left text-xs outline-none hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-primary aria-pressed:bg-primary/10"
                  onClick={() => setCharacterId(character.id)}
                  type="button"
                >
                  <img
                    alt={characterAlt(character)}
                    className="aspect-4/7 w-full rounded-lg bg-foreground/5 object-cover"
                    src={mediaUrl(character.image)}
                  />
                  <span className="truncate">{characterName(character)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="storyboard-sequence">Sequence</Label>
        <Textarea
          id="storyboard-sequence"
          maxLength={1000}
          onChange={(event) => setSequence(event.target.value)}
          placeholder="Maya arrives on an empty rooftop at sunset, stretches, breakdances as the city lights come on, then sits on the ledge looking at the skyline."
          rows={3}
          value={sequence}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="storyboard-title">Title (optional)</Label>
          <Input
            id="storyboard-title"
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </div>
        <StylePicker onChange={setStyle} value={style} />
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium" id="scene-source">
          Scenes
        </span>
        <ToggleGroup
          aria-labelledby="scene-source"
          onValueChange={(value) => {
            if (value === "model" || value === "manual") {
              setSource(value);
            }
          }}
          type="single"
          value={source}
          variant="outline"
        >
          <ToggleGroupItem value="model">Split it for me</ToggleGroupItem>
          <ToggleGroupItem value="manual">I'll write four</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-sm text-soft-foreground">
          {source === "model"
            ? "An open-weights text model (Qwen3.5 4B) splits the sequence into four scenes. You can edit every one before rendering."
            : "Write each scene yourself: what the character does, where, and the framing."}
        </p>
        {source === "manual" && (
          <ol className="grid gap-3 sm:grid-cols-2">
            {scenes.map((scene, position) => (
              // The four places are fixed, so the position is the scene's identity.
              // oxlint-disable-next-line react/no-array-index-key
              <li className="flex flex-col gap-1.5" key={position}>
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
                  rows={3}
                  value={scene}
                />
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Button disabled={!ready || busy} type="submit">
          {busy ? "Creating…" : "Create storyboard"}
          <ArrowRightIcon />
        </Button>
        {refusal && (
          <p className="text-sm text-destructive-foreground" role="alert">
            {refusal}
          </p>
        )}
      </div>
    </form>
  );
}

function StoryboardIndex({ list }: { list: StoryboardList }) {
  return (
    <section aria-labelledby="storyboard-index" className="flex flex-col gap-4">
      <h2 className="font-display text-2xl font-semibold" id="storyboard-index">
        Your storyboards
      </h2>
      {list.storyboards.length === 0 ? (
        <p className="text-soft-foreground">No storyboards yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.storyboards.map((storyboard) => {
            const done = storyboard.statuses.filter((status) => status === "done").length;

            const failed = storyboard.statuses.filter(
              (status) => status === "failed" || status === "cancelled" || status === "unknown",
            ).length;

            return (
              <li key={storyboard.id}>
                <Link
                  className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1 p-3 outline-none hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  params={{ storyboardId: storyboard.id }}
                  to="/storyboards/$storyboardId"
                >
                  <img
                    alt={characterAlt(storyboard.character)}
                    className="h-14 w-8 rounded-md bg-foreground/5 object-cover"
                    src={mediaUrl(storyboard.character.image)}
                  />
                  <span className="font-medium">
                    {storyboard.title ?? `${characterName(storyboard.character)}'s storyboard`}
                  </span>
                  <time className="text-sm text-muted-foreground" dateTime={storyboard.updated_at}>
                    {new Date(storyboard.updated_at).toLocaleString()}
                  </time>
                  <span className="flex flex-wrap gap-2">
                    <Badge variant="brand">
                      {done} of {CARD_COUNT} rendered
                    </Badge>
                    {failed > 0 && <Badge variant="destructive">{failed} failed</Badge>}
                  </span>
                  <ArrowRightIcon aria-hidden="true" className="ml-auto size-4" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
