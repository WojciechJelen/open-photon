import { Link, useNavigate } from "@tanstack/react-router";
import { CameraIcon, UserIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import type { CharacterSummary } from "#/features/characters";
import editorial from "#/features/photoshoot/assets/setting-editorial.webp";
import outdoors from "#/features/photoshoot/assets/setting-outdoors.webp";
import street from "#/features/photoshoot/assets/setting-street.webp";
import studio from "#/features/photoshoot/assets/setting-studio.webp";
import {
  PhotoshootShell,
  usePhotoshootRead,
} from "#/features/photoshoot/components/photoshoot-shell";
import type { PhotoshootList } from "#/features/photoshoot/contracts";
import { characterLabel, photoshootTitle } from "#/features/photoshoot/labels";
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
import { PageHeading } from "#/shared/components/page-heading";
import { AddTile, PictureTile } from "#/shared/components/picture-tile";
import { StableText } from "#/shared/components/stable-text";
import { SummaryPanel, SummaryRow } from "#/shared/components/summary-panel";
import { ToolColumns, ToolSection } from "#/shared/components/tool-layout";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";
import { revealInRow, revealPressed } from "#/shared/reveal-in-row";
import { dayAndTime } from "#/shared/when";

type PageData = { characters: CharacterSummary[]; history: PhotoshootList["photoshoots"] };

// Each setting as a real result of it: `docs/feature-evidence/character-photoshoot`'s sample Arthur.
const settingImages: Record<PhotoshootSettingId, { position: string; src: string }> = {
  editorial: { position: "object-top", src: editorial },
  outdoors: { position: "object-[50%_20%]", src: outdoors },
  street: { position: "object-top", src: street },
  studio: { position: "object-top", src: studio },
};

// How many tiles hold the library's place until it is read.
const LIBRARY_PLACEHOLDERS = 6;

// A tile of the character row: a phone's row scrolls, with room for the ring and the focus outline
// around a tile; wider screens fill a grid.
const characterItem = "w-24 shrink-0 sm:w-auto";

/**
 * "Add a photo": the file picker, then the dialog that asks for the uploader's likeness consent,
 * the characters feature's convention: a PNG, JPEG or WebP of a person, and consent ticked before
 * the upload is possible. It joins the library. Nothing leaves the browser until "Use photo", and
 * from there the dialog stays until the server answers, so a refusal has somewhere to show.
 */
function AddPhoto({
  disabled,
  onUploaded,
}: {
  disabled: boolean;
  onUploaded: (character: CharacterSummary) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = photo?.preview;

  // The preview URL lives as long as the photo is kept: through the dialog's way out.
  useEffect(() => (preview ? () => URL.revokeObjectURL(preview) : undefined), [preview]);

  function pick(file: File) {
    setPhoto({ file, preview: URL.createObjectURL(file) });
    setConsent(false);
    setError(null);
    setOpen(true);
  }

  async function send(file: File) {
    setBusy(true);
    setError(null);

    const result = await uploadReference(file);

    setBusy(false);

    if ("refusal" in result) {
      setError(result.refusal.message);

      return;
    }

    setOpen(false);
    onUploaded(result.data);
  }

  return (
    <>
      <AddTile caption="Add a photo" disabled={disabled} onClick={() => input.current?.click()} />
      <input
        accept="image/png,image/jpeg,image/webp"
        aria-label="Reference photo"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];

          // The same file picked again fires `change` again.
          event.target.value = "";

          if (file) {
            pick(file);
          }
        }}
        ref={input}
        type="file"
      />
      <Dialog onOpenChange={(next) => setOpen(next || busy)} open={open}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Add a photo</DialogTitle>
            <DialogDescription>
              PNG, JPEG or WebP of one person, clearly lit, and only with their consent. It joins
              this workspace's library.
            </DialogDescription>
          </DialogHeader>
          {photo && (
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative block h-14 w-11 shrink-0 overflow-hidden rounded-thumb bg-screen shadow-hairline">
                {/* A file that only claims to be an image shows no broken-image mark. */}
                <img
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                  key={photo.preview}
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                  }}
                  src={photo.preview}
                />
              </span>
              <span className="min-w-0 truncate type-label" title={photo.file.name}>
                {photo.file.name}
              </span>
            </div>
          )}
          <div className="flex flex-col gap-2">
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
            <p
              className="min-h-5 type-caption wrap-anywhere text-destructive-foreground"
              role="alert"
            >
              {error}
            </p>
          </div>
          <DialogFooter>
            <Button
              disabled={!photo || !consent || busy}
              onClick={() => photo && void send(photo.file)}
            >
              <StableText
                current={busy ? "Uploading…" : "Use photo"}
                labels={["Use photo", "Uploading…"]}
              />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * An earlier photoshoot: its four shots, one tag for the strip (each is too small to hold its own),
 * a shot still to come an empty box of the same size.
 */
function EarlierPhotoshoot({ entry }: { entry: PageData["history"][number] }) {
  const title = photoshootTitle(entry.character, entry.setting);
  const done = entry.statuses.filter((status) => status === "done").length;
  const when = dayAndTime(entry.created_at);

  const progress =
    done < entry.statuses.length ? ` · ${done} of ${entry.statuses.length} done` : "";

  return (
    <li className="min-w-0">
      <Link
        className="flex min-w-0 items-center gap-3.5 rounded-xl border bg-card/72 py-2.5 pr-4 pl-2.5 transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        params={{ photoshootId: entry.id }}
        to="/photoshoot/$photoshootId"
      >
        <span className="relative flex shrink-0 gap-0.75">
          {entry.stills.map((still, position) => (
            <span
              className="relative block h-14 w-9.5 overflow-hidden rounded-sm bg-screen"
              key={position}
            >
              {still && (
                <img
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                  src={mediaUrl(still)}
                />
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
          <span className="truncate type-label text-foreground" title={title}>
            {title}
          </span>
          <span className="truncate type-caption text-muted-foreground" title={when + progress}>
            <time dateTime={entry.created_at}>{when}</time>
            {progress}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * `/photoshoot`: pick a library character (or add a photo of a person, with consent), pick a
 * setting, and shoot four photos of them there, each a different pose and light; below, the
 * workspace's earlier photoshoots. Shooting opens the photoshoot's page. What needs no read is
 * there from the start; the library's tiles hold their place until it is read.
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

  const ready = loaded.kind === "ready" ? loaded : null;
  const picked = ready?.characters.find(({ id }) => id === characterId);
  const chosen = photoshootSetting(setting);
  const row = useRef<HTMLUListElement>(null);

  // A pick stays in the row's view: a photo just added goes first, wherever the row was scrolled.
  useEffect(() => revealPressed(row.current), [characterId, ready?.characters]);

  const heading = (
    <PageHeading
      subtitle={
        <>
          Four new photos of one character
          <span className="max-sm:hidden">, same face and outfit</span>.
        </>
      }
      title="Photoshoot"
    />
  );

  return (
    <PhotoshootShell
      access={access}
      askForCode={askForCode}
      gap={10}
      loaded={loaded}
      locked="Enter the access code to start a photoshoot."
      top={10}
      waiting="Loading your library…"
    >
      {ready || loaded.kind === "loading" ? (
        <ToolColumns
          aside={
            <div data-testid="photoshoot-summary">
              <SummaryPanel
                actions={
                  <Button
                    disabled={!picked || submitting}
                    onClick={() => picked && void shoot(picked.id)}
                    variant="photon"
                  >
                    <CameraIcon />
                    <StableText
                      current={submitting ? "Starting…" : "Shoot 4 photos"}
                      labels={["Shoot 4 photos", "Starting…"]}
                    />
                  </Button>
                }
                label="Your shoot"
                note={
                  refusal && (
                    <span className="text-destructive-foreground" role="alert">
                      {refusal.message}
                    </span>
                  )
                }
              >
                <SummaryRow
                  icon={<UserIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
                  image={picked && mediaUrl(picked.image)}
                  label="Character"
                  placeholder="Pick a character"
                  value={picked && characterLabel(picked)}
                />
                <SummaryRow
                  image={settingImages[setting].src}
                  label="Setting"
                  value={chosen.title}
                />
              </SummaryPanel>
            </div>
          }
        >
          {heading}

          <ToolSection
            end={
              // The links keep 44 px targets; the row stays as low as its heading.
              <div className="-my-2 flex max-w-full flex-wrap gap-x-4 max-sm:hidden">
                <Button asChild size="inline" variant="link">
                  <Link search={{ draft: undefined }} to="/characters">
                    Open library
                  </Link>
                </Button>
                <Button asChild size="inline" variant="link">
                  <Link to="/characters/new">Describe a new one</Link>
                </Button>
              </div>
            }
            number="01"
            title="Character"
          >
            <ul
              aria-busy={!ready}
              aria-label="Characters"
              className="-mr-4 -ml-1.5 flex gap-2.5 overflow-x-auto py-1.5 pr-4 pl-1.5 sm:mx-0 sm:grid sm:grid-fill-28 sm:gap-3 sm:overflow-visible sm:p-0"
              onFocus={(event) => revealInRow(event.target, event.currentTarget)}
              ref={row}
            >
              <li className={characterItem}>
                <AddPhoto
                  disabled={!ready}
                  onUploaded={(character) => {
                    if (ready) {
                      setLoaded({
                        ...ready,
                        characters: [
                          character,
                          ...ready.characters.filter(({ id }) => id !== character.id),
                        ],
                      });
                    }

                    setCharacterId(character.id);
                  }}
                />
              </li>
              {ready
                ? ready.characters.map((character) => {
                    const name = characterLabel(character);

                    return (
                      <li className={characterItem} key={character.id}>
                        <PictureTile
                          alt={character.origin === "generated" ? "AI-generated image" : ""}
                          caption={name}
                          onClick={() => setCharacterId(character.id)}
                          pressed={character.id === characterId}
                          src={mediaUrl(character.image)}
                          tagged={character.origin === "generated" && !character.is_sample}
                        />
                      </li>
                    );
                  })
                : Array.from({ length: LIBRARY_PLACEHOLDERS }, (_, position) => (
                    <li aria-hidden="true" className={characterItem} key={position}>
                      <span className="flex flex-col gap-2">
                        <span className="block aspect-4/7 skeleton rounded-lg" />
                        <span className="type-caption">&nbsp;</span>
                      </span>
                    </li>
                  ))}
            </ul>
          </ToolSection>

          <ToolSection number="02" title="Setting">
            {/* Two by two on a phone, one row beside it: four settings never leave one alone. */}
            <div
              aria-label="Settings"
              className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-3.5"
              role="group"
            >
              {photoshootSettings.map((entry) => (
                <PictureTile
                  alt="AI-generated image"
                  aspect="aspect-3/4"
                  caption={entry.title}
                  key={entry.id}
                  onClick={() => setSetting(entry.id)}
                  position={settingImages[entry.id].position}
                  pressed={entry.id === setting}
                  ringOnly
                  src={settingImages[entry.id].src}
                  strong
                  title={entry.summary}
                />
              ))}
            </div>
          </ToolSection>
        </ToolColumns>
      ) : (
        heading
      )}

      {ready && ready.history.length > 0 && (
        // After the aside in the page's order, so a phone reaches Shoot first; beside it on a wide
        // screen this stays in the form's column: 340 of aside + 40 of gap.
        <div className="sm:-mt-1 lg:pr-95">
          <ToolSection title="Earlier photoshoots">
            <ul className="grid grid-fill-80 gap-2.5">
              {ready.history.map((entry) => (
                <EarlierPhotoshoot entry={entry} key={entry.id} />
              ))}
            </ul>
          </ToolSection>
        </div>
      )}
    </PhotoshootShell>
  );
}
