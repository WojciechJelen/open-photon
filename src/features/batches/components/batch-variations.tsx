import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { KeyRoundIcon, LayersIcon, ShuffleIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import {
  characterAlt,
  characterName,
  fetchBatches,
  fetchCharacters,
  postBatch,
  lookLabel,
  randomSeeds,
  seedLabel,
} from "#/features/batches/batch-client";
import {
  type BatchVariation,
  MAX_CHARACTERS,
  MIN_CHARACTERS,
  SEED_COUNTS,
} from "#/features/batches/contracts";
import {
  forgetPending,
  recallPending,
  rememberPending,
  variationKey,
} from "#/features/batches/pending-request";
import type { CharacterSummary } from "#/features/characters";
import type { DraftSnapshot } from "#/features/motionTransfer/api";
import { Hud } from "#/shared/components/brand";
import { PictureTile } from "#/shared/components/picture-tile";
import { StableText } from "#/shared/components/stable-text";
import type { Allowance } from "#/shared/contracts";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";

/** Where the action sits: the Direct step's panel, or a finished take's row of text links. */
type Place = "panel" | "result";

/**
 * The composer's generation actions with batch variations beside them: `action` is the plain
 * action the composition keeps (Generate, or Re-run), and "Variations" opens the batch dialog for
 * the immutable `draft` the slot was given (`DraftSnapshot`). The composition mounts it in the
 * `directGenerationActions` and `resultGenerationActions` slots (`src/app/composer-slots.ts`).
 */
export function BatchVariations({
  action,
  draft,
  place,
}: {
  action: ReactNode;
  draft: DraftSnapshot;
  place: Place;
}) {
  const [open, setOpen] = useState(false);
  // Each opening starts a new session of the dialog (fresh seeds, fresh reads).
  const [session, setSession] = useState(0);
  const ready = draft.motion !== undefined;

  // The dialog's trigger: closing the dialog gives it the focus back.
  const trigger = (
    <DialogTrigger asChild>
      <Button
        disabled={!ready}
        size={place === "panel" ? "lg" : "inline"}
        type="button"
        variant={place === "panel" ? "outline" : "link"}
      >
        {place === "panel" && <LayersIcon />}
        Variations
      </Button>
    </DialogTrigger>
  );

  return (
    <Dialog
      onOpenChange={(next) => {
        if (next) {
          setSession((current) => current + 1);
        }

        setOpen(next);
      }}
      open={open}
    >
      {place === "panel" ? (
        <div className="grid gap-2">
          {action}
          {trigger}
        </div>
      ) : (
        <>
          {action}
          {trigger}
        </>
      )}
      {open && <VariationsDialog draft={draft} key={session} />}
    </Dialog>
  );
}

type Reads =
  | { kind: "loading" }
  | { kind: "access" }
  | { kind: "error"; refusal: Refusal }
  | { allowance: Allowance; characters: CharacterSummary[]; kind: "ready" };

/** The two reads the dialog needs, together: the allowance and the characters to vary. */
function useReads() {
  const [reads, setReads] = useState<Reads>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    void Promise.all([fetchBatches(controller.signal), fetchCharacters(controller.signal)]).then(
      ([batches, library]) => {
        if (controller.signal.aborted) {
          return;
        }

        if ("data" in batches && "data" in library) {
          setReads({
            allowance: batches.data.allowance,
            characters: library.data.characters,
            kind: "ready",
          });

          return;
        }

        const refusal =
          "refusal" in batches ? batches.refusal : "refusal" in library ? library.refusal : null;

        setReads(
          refusal?.reason === "access_required"
            ? { kind: "access" }
            : { kind: "error", refusal: refusal ?? { message: "The request failed. Try again." } },
        );
      },
    );

    return () => controller.abort();
  }, []);

  return reads;
}

// The label of Render at its widest, so the button keeps its width as the count changes.
const WIDEST_RENDER = `Render ${MAX_CHARACTERS} takes`;

// Character tiles: six to the row as on the board, three on a phone.
const tiles = "grid grid-cols-3 gap-3 sm:grid-cols-6";

// A tile out of reach once six are picked, in the disabled controls' terms: quiet, its caption
// muted, and never a faded opacity.
const takenTile =
  "disabled:*:first:brightness-40 disabled:*:first:grayscale disabled:*:last:text-muted-foreground";

/**
 * The batch dialog: what varies (two or four seeds, or two to six characters), what stays the
 * same, each seed it will try, the renders it needs against what the access code has left, and
 * Render, which admits the batch and opens its page (`/batches/:id`). On a short screen the
 * dialog scrolls and its footer stays in view. The request key belongs to the exact batch asked
 * for: asking again for it (a lost answer, a second click) returns the batch already admitted. A
 * request this tab sent for the shot without getting its batch (`recallPending`: the answer was
 * lost, the dialog closed, the page reloaded) opens the dialog on that request again, under its
 * key, rather than on fresh seeds.
 */
function VariationsDialog({ draft }: { draft: DraftSnapshot }) {
  const navigate = useNavigate();
  const reads = useReads();
  const [pending] = useState(() => recallPending(draft));
  const sent = pending?.variation;
  const [kind, setKind] = useState<BatchVariation["kind"]>(sent?.kind ?? "seeds");

  const [count, setCount] = useState<number>(
    sent?.kind === "seeds" ? sent.seeds.length : SEED_COUNTS[0],
  );

  const [seeds, setSeeds] = useState(() =>
    randomSeeds(SEED_COUNTS[SEED_COUNTS.length - 1] ?? 4, sent?.kind === "seeds" ? sent.seeds : []),
  );

  const [picked, setPicked] = useState<string[]>(
    sent?.kind === "characters" ? sent.characters : draft.character ? [draft.character] : [],
  );

  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const keys = useRef(
    new Map<string, string>(pending ? [[variationKey(pending.variation), pending.key]] : []),
  );

  const characters = reads.kind === "ready" ? reads.characters : [];
  const byId = new Map(characters.map((character) => [character.id, character]));
  // Only characters the library lists can be varied (the shot's own may not be one of them).
  const chosen = picked.filter((id) => byId.has(id));
  const takes = seeds.slice(0, count);

  const variation: BatchVariation =
    kind === "seeds" ? { kind, seeds: takes } : { characters: chosen, kind };

  const resending = sent !== undefined && variationKey(sent) === variationKey(variation);

  const valid =
    kind === "seeds"
      ? draft.character !== undefined
      : chosen.length >= MIN_CHARACTERS && chosen.length <= MAX_CHARACTERS;

  const size = kind === "seeds" ? count : chosen.length;
  const noun = size === 1 ? "take" : "takes";
  const renders = `${size} ${size === 1 ? "render" : "renders"}`;
  // What the code has left is shown, not enforced: only new takes are charged, and only the
  // server knows which takes are already rendered, so its atomic admission decides.
  const remaining = reads.kind === "ready" ? reads.allowance.remaining : null;
  const beyond = remaining !== null && remaining < size;

  const togglePick = (id: string) => {
    setRefusal(null);
    setPicked((current) =>
      current.includes(id)
        ? current.filter((each) => each !== id)
        : current.length < MAX_CHARACTERS
          ? [...current, id]
          : current,
    );
  };

  async function submit() {
    const identity = variationKey(variation);
    const requestKey = keys.current.get(identity) ?? crypto.randomUUID();

    keys.current.set(identity, requestKey);
    // Recorded before it is sent and kept until a batch opens: a refusal does not prove an
    // earlier send of this key was not admitted (an expired session is refused before the key is
    // looked up), so only the batch itself settles it.
    rememberPending(draft, variation, requestKey);
    setSubmitting(true);
    setRefusal(null);

    const result = await postBatch({ shot: draft, variation }, requestKey);

    if ("data" in result) {
      forgetPending(draft);
      await navigate({ params: { batchId: result.data.id }, to: "/batches/$batchId" });

      return;
    }

    setSubmitting(false);
    setRefusal(result.refusal);
  }

  const shotCharacter = draft.character ? byId.get(draft.character) : undefined;

  const kept =
    kind === "characters"
      ? seedLabel(draft)
      : shotCharacter
        ? characterName(shotCharacter)
        : "The picked character";

  return (
    <DialogContent size="md">
      <DialogHeader>
        <DialogTitle>Variations</DialogTitle>
        <DialogDescription>Render several takes of this shot and compare them.</DialogDescription>
      </DialogHeader>

      {/* One grid item: a sticky footer only travels inside the box around it. Its offset and
          margins cancel the dialog's padding, which sticky offsets are measured from. */}
      <div className="flex min-w-0 flex-col gap-5">
        <ToggleGroup
          aria-label="What to vary"
          disabled={reads.kind !== "ready"}
          onValueChange={(value) => {
            if (value === "seeds" || value === "characters") {
              setKind(value);
              setRefusal(null);
            }
          }}
          spacing={1}
          type="single"
          value={kind}
          variant="segmented"
        >
          <ToggleGroupItem value="seeds">Seeds</ToggleGroupItem>
          <ToggleGroupItem value="characters">Characters</ToggleGroupItem>
        </ToggleGroup>

        {/* The height of a row of characters, so changing what varies moves nothing. */}
        <div className="flex min-w-0 flex-col sm:min-h-45.5">
          {reads.kind === "loading" && (
            <p className="sr-only" role="status">
              Loading your allowance and characters…
            </p>
          )}

          {reads.kind === "loading" && kind === "characters" && (
            <div aria-hidden="true" className={tiles}>
              {Array.from({ length: MAX_CHARACTERS }, (_, index) => (
                <div className="aspect-4/7 skeleton rounded-lg" key={index} />
              ))}
            </div>
          )}

          {reads.kind === "access" && (
            <div className="flex flex-col items-start gap-3" role="alert">
              <p className="text-sm text-soft-foreground">
                Batches render new takes, which needs an access code.
              </p>
              <Button asChild size="sm" variant="outline">
                <a
                  href={`/access?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`}
                >
                  <KeyRoundIcon />
                  Enter access code
                </a>
              </Button>
            </div>
          )}

          {reads.kind === "error" && (
            <p className="text-sm wrap-anywhere text-destructive-foreground" role="alert">
              {reads.refusal.message}
            </p>
          )}

          {/* The seeds wait for neither read, so they are there from the first frame. */}
          {(reads.kind === "ready" || reads.kind === "loading") && kind === "seeds" && (
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <ToggleGroup
                  aria-label="How many takes"
                  onValueChange={(value) => {
                    if (value) {
                      setCount(Number(value));
                      setRefusal(null);
                    }
                  }}
                  spacing={1}
                  type="single"
                  value={String(count)}
                  variant="segmented"
                >
                  {SEED_COUNTS.map((each) => (
                    <ToggleGroupItem key={each} value={String(each)}>
                      {`${each} takes`}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Button
                  onClick={() => {
                    setSeeds(randomSeeds(seeds.length));
                    setRefusal(null);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <ShuffleIcon />
                  New seeds
                </Button>
              </div>
              {valid && (
                <ol aria-label="Takes" className="grid gap-2 sm:grid-cols-2">
                  {takes.map((seed, index) => (
                    <li
                      className="flex h-11 min-w-0 items-center justify-between gap-3 rounded-field border bg-card/72 px-3.5"
                      key={seed}
                    >
                      <Hud>Take {index + 1}</Hud>
                      <span className="min-w-0 truncate type-caption font-medium text-soft-foreground tabular-nums">
                        Seed {seed}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {reads.kind === "ready" && kind === "characters" && (
            <div aria-label="Characters" className={tiles} role="group">
              {characters.map((character) => {
                const on = picked.includes(character.id);

                return (
                  <PictureTile
                    alt={characterAlt(character)}
                    caption={characterName(character)}
                    className={takenTile}
                    disabled={!on && chosen.length >= MAX_CHARACTERS}
                    key={character.id}
                    onClick={() => togglePick(character.id)}
                    pressed={on}
                    src={mediaUrl(character.image)}
                    tagged={character.origin === "generated" && !character.is_sample}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Held while the reads are on their way: the character's name is one of them. */}
        <dl
          className={cn(
            "flex min-w-0 flex-wrap gap-x-6 gap-y-1",
            reads.kind !== "ready" && "invisible",
          )}
        >
          <KeptRow label="Look" value={lookLabel(draft)} />
          <KeptRow label={kind === "seeds" ? "Character" : "Seed"} value={kept} />
        </dl>

        <div className="sticky -bottom-6 -mx-6 -mb-6 bg-popover px-6 pb-6 sm:-bottom-7 sm:-mx-7 sm:-mb-7 sm:px-7 sm:pb-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="flex min-h-11 min-w-0 flex-1 basis-56 flex-col justify-center">
              {refusal ? (
                <p className="type-caption wrap-anywhere text-destructive-foreground" role="alert">
                  {refusal.message}
                </p>
              ) : resending ? (
                <p className="type-caption text-soft-foreground" role="status">
                  These are the takes you last asked for. Render opens their batch if it has already
                  started.
                </p>
              ) : (
                <>
                  <span className="truncate font-semibold">
                    {valid
                      ? `${size} ${noun}`
                      : kind === "seeds"
                        ? "Pick a character first"
                        : `Pick at least ${MIN_CHARACTERS} characters`}
                  </span>
                  <span
                    className={cn(
                      "type-caption",
                      beyond ? "text-warning-foreground" : "text-muted-foreground",
                    )}
                  >
                    {kind === "characters" && !valid
                      ? `Up to ${MAX_CHARACTERS} in one batch`
                      : beyond
                        ? `Uses up to ${renders}, your access code has ${remaining} left`
                        : `Uses up to ${renders}`}
                  </span>
                </>
              )}
            </div>
            <div className="flex grow flex-col sm:grow-0">
              <Button
                disabled={reads.kind !== "ready" || !valid || submitting}
                onClick={() => void submit()}
                type="button"
                variant="photon"
              >
                <LayersIcon />
                <StableText
                  current={submitting ? "Starting…" : `Render ${size} ${noun}`}
                  labels={[...new Set([`Render ${size} ${noun}`, WIDEST_RENDER, "Starting…"])]}
                />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

/** One thing every take keeps, on one line: `value` is cut short, with its whole text on hover. */
function KeptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 basis-60 items-baseline gap-2 first:grow-999">
      <dt className="shrink-0">
        <Hud>{label}</Hud>
      </dt>
      <dd className="min-w-0 truncate type-caption text-soft-foreground" title={value}>
        {value}
      </dd>
    </div>
  );
}
