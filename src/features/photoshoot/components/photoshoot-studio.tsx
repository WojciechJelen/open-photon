import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowRightIcon, CameraIcon, CheckIcon, ImageUpIcon } from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import type { CharacterSummary } from "#/features/characters";
import {
  PhotoshootShell,
  usePhotoshootRead,
} from "#/features/photoshoot/components/photoshoot-shell";
import type { PhotoshootList } from "#/features/photoshoot/contracts";
import {
  fetchLibrary,
  fetchPhotoshoots,
  postPhotoshoot,
  uploadReference,
} from "#/features/photoshoot/photoshoot-client";
import {
  type PhotoshootSettingId,
  photoshootSetting,
  photoshootSettings,
} from "#/features/photoshoot/settings";
import { Hud } from "#/shared/components/brand";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";

type PageData = { characters: CharacterSummary[]; history: PhotoshootList["photoshoots"] };

/** What the library calls a character: its title, or what it is. */
export function characterLabel(character: Pick<CharacterSummary, "origin" | "title">) {
  return (
    character.title ?? (character.origin === "upload" ? "Untitled photo" : "Untitled character")
  );
}

/**
 * A photo of a person into the library, the characters feature's convention: a PNG, JPEG or WebP
 * and the uploader's likeness consent, ticked before the upload is possible.
 */
function ReferenceUpload({ onUploaded }: { onUploaded: (character: CharacterSummary) => void }) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(photo: File) {
    setBusy(true);
    setError(null);

    const result = await uploadReference(photo);

    setBusy(false);

    if ("refusal" in result) {
      setError(result.refusal.message);

      return;
    }

    setFile(null);
    setConsent(false);
    onUploaded(result.data);
  }

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-dashed p-4">
      <span className="flex items-center gap-2 font-medium">
        <ImageUpIcon aria-hidden="true" className="size-4" />
        Upload a reference photo
      </span>
      <p className="text-sm text-soft-foreground">
        PNG, JPEG or WebP of one person, clearly lit, and only with their consent. It joins this
        workspace's library.
      </p>
      <input
        accept="image/png,image/jpeg,image/webp"
        aria-label="Reference photo"
        className="text-sm file:mr-3 file:rounded-full file:border file:bg-transparent file:px-3 file:py-1 file:text-foreground"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        type="file"
      />
      <div className="flex items-start gap-2">
        <Checkbox
          checked={consent}
          id={`${id}-consent`}
          onCheckedChange={(checked) => setConsent(checked === true)}
        />
        <label className="text-sm leading-snug" htmlFor={`${id}-consent`}>
          I may use this person's likeness: it's me, or they agreed to it.
        </label>
      </div>
      {error && (
        <p className="text-sm text-destructive-foreground" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button
          disabled={!file || !consent || busy}
          onClick={() => file && void send(file)}
          size="sm"
        >
          {busy ? "Uploading…" : "Use photo"}
        </Button>
      </div>
    </div>
  );
}

/** A library character as a pick: the whole tile toggles it (`aria-pressed`). */
function CharacterTile({
  character,
  onPick,
  picked,
}: {
  character: CharacterSummary;
  onPick: () => void;
  picked: boolean;
}) {
  const name = characterLabel(character);

  return (
    <button
      aria-pressed={picked}
      className={cn(
        "relative block aspect-3/4 w-full cursor-pointer overflow-hidden rounded-xl border bg-card text-left transition hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
        picked && "border-transparent shadow-picked",
      )}
      onClick={onPick}
      type="button"
    >
      <img
        alt={character.origin === "generated" ? `${name}, AI-generated image` : name}
        className="absolute inset-0 size-full object-cover"
        src={mediaUrl(character.image)}
      />
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-2/5 bg-linear-to-b from-transparent to-background/95"
      />
      {picked && (
        <span
          aria-hidden="true"
          className="absolute top-3 right-3 grid size-7 place-items-center rounded-full bg-brand text-primary-foreground"
        >
          <CheckIcon className="size-4" strokeWidth={3} />
        </span>
      )}
      <span className="absolute inset-x-3 bottom-2.5 line-clamp-2 text-sm font-semibold">
        {name}
      </span>
    </button>
  );
}

/**
 * `/photoshoot`: pick a library character (or add a photo of a person, with consent), pick a
 * setting, and shoot four photos of them there, each a different pose and light; below, the
 * workspace's earlier photoshoots. Shooting opens the photoshoot's page.
 */
export function PhotoshootStudio() {
  const [characterId, setCharacterId] = useState<string | undefined>();
  const [setting, setSetting] = useState<PhotoshootSettingId>("studio");
  // One key per photoshoot asked for: kept until it is admitted, so a lost answer or a second
  // click sends the same key and gets the same photoshoot.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const navigate = useNavigate();

  const { access, askForCode, loaded, setLoaded } = usePhotoshootRead<PageData>(async (signal) => {
    const [library, history] = await Promise.all([fetchLibrary(signal), fetchPhotoshoots(signal)]);

    if ("refusal" in library) {
      return library;
    }

    return "refusal" in history
      ? history
      : { data: { characters: library.data.characters, history: history.data.photoshoots } };
  });

  async function shoot(id: string) {
    setSubmitting(true);
    setRefusal(null);

    const result = await postPhotoshoot({ character_id: id, setting }, requestKey);

    setSubmitting(false);

    if ("refusal" in result) {
      if (result.refusal.reason === "access_required") {
        access.hold("photoshoot-generate", "generate", () => void shoot(id));
      } else {
        setRefusal(result.refusal);
      }

      return;
    }

    setRequestKey(crypto.randomUUID());
    void navigate({ params: { photoshootId: result.data.id }, to: "/photoshoot/$photoshootId" });
  }

  const picked =
    loaded.kind === "ready" ? loaded.characters.find(({ id }) => id === characterId) : undefined;

  const chosen = photoshootSetting(setting);

  return (
    <PhotoshootShell
      access={access}
      askForCode={askForCode}
      loaded={loaded}
      locked="Enter the access code to start a photoshoot."
      waiting="Loading your library…"
    >
      <div className="flex flex-col gap-4">
        <Hud>Image · FLUX 3 Image Klein edit</Hud>
        <h1 className="font-display text-4xl leading-none font-bold tracking-display sm:text-5xl">
          Character photoshoot
        </h1>
        <p className="max-w-2xl text-soft-foreground">
          Put a character in a new setting: four photos, each with its own pose and light, keeping
          their face, outfit and accessories. Save the ones you like to the library.
        </p>
      </div>

      {loaded.kind === "ready" && (
        <>
          <section aria-labelledby="character-heading" className="flex flex-col gap-4">
            <h2 className="font-display text-2xl font-semibold" id="character-heading">
              1. Character
            </h2>
            <ul
              aria-label="Characters"
              className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 xl:grid-cols-6"
            >
              <li className="col-span-2">
                <ReferenceUpload
                  onUploaded={(character) => {
                    setLoaded({
                      ...loaded,
                      characters: [
                        character,
                        ...loaded.characters.filter(({ id }) => id !== character.id),
                      ],
                    });
                    setCharacterId(character.id);
                  }}
                />
              </li>
              {loaded.characters.map((character) => (
                <li key={character.id}>
                  <CharacterTile
                    character={character}
                    onPick={() => setCharacterId(character.id)}
                    picked={character.id === characterId}
                  />
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="setting-heading" className="flex flex-col gap-4">
            <h2 className="font-display text-2xl font-semibold" id="setting-heading">
              2. Setting
            </h2>
            <div
              aria-labelledby="setting-heading"
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              role="radiogroup"
            >
              {photoshootSettings.map((entry) => (
                <button
                  aria-checked={entry.id === setting}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-2xl border p-4 text-left transition hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    entry.id === setting && "border-brand/60 bg-brand/8",
                  )}
                  key={entry.id}
                  onClick={() => setSetting(entry.id)}
                  role="radio"
                  type="button"
                >
                  <span className="font-semibold">{entry.title}</span>
                  <span className="text-sm text-soft-foreground">{entry.summary}</span>
                </button>
              ))}
            </div>
            <p className="text-sm text-soft-foreground">
              Shots: {chosen.shots.map(({ label }) => label).join(" · ")}
            </p>
          </section>

          <section className="flex flex-wrap items-center gap-4">
            <Button
              disabled={!picked || submitting}
              onClick={() => picked && void shoot(picked.id)}
              size="lg"
              variant="photon"
            >
              <CameraIcon />
              {submitting ? "Starting…" : "Shoot 4 photos"}
            </Button>
            <span className="text-sm text-soft-foreground">
              {picked
                ? `${characterLabel(picked)} · ${chosen.title} · 4 generations`
                : "Pick a character first."}
            </span>
            {refusal && (
              <p className="w-full text-sm text-destructive-foreground" role="alert">
                {refusal.message}
              </p>
            )}
          </section>

          <section aria-labelledby="history-heading" className="flex flex-col gap-4">
            <h2 className="font-display text-2xl font-semibold" id="history-heading">
              Earlier photoshoots
            </h2>
            {loaded.history.length === 0 ? (
              <p className="text-soft-foreground">None yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {loaded.history.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border p-4 hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      params={{ photoshootId: entry.id }}
                      to="/photoshoot/$photoshootId"
                    >
                      <span className="font-medium">
                        {entry.character ? characterLabel(entry.character) : "A character"} ·{" "}
                        {photoshootSetting(entry.setting).title}
                      </span>
                      <time className="text-sm text-muted-foreground" dateTime={entry.created_at}>
                        {new Date(entry.created_at).toLocaleString()}
                      </time>
                      <Badge variant="brand">
                        {entry.statuses.filter((status) => status === "done").length} of{" "}
                        {entry.statuses.length} done
                      </Badge>
                      <ArrowRightIcon aria-hidden="true" className="ml-auto size-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </PhotoshootShell>
  );
}
