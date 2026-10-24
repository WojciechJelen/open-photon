import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { CheckIcon, DicesIcon, KeyRoundIcon, LayersIcon, ShuffleIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  type Allowance,
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
import { planItems } from "#/features/batches/variations";
import type { CharacterSummary } from "#/features/characters";
import type { DraftSnapshot } from "#/features/motionTransfer/api";
import { Hud } from "#/shared/components/brand";
import { mediaUrl } from "#/shared/media";
import type { Refusal } from "#/shared/requests";

/**
 * Where the action sits: the Direct step's panel (from `lg`) or its bottom bar, or a finished
 * take's recipe panel (`result`).
 */
type Place = "bar" | "panel" | "result";

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
        aria-label={place === "bar" ? "Batch variations" : undefined}
        disabled={!ready}
        size={place === "bar" ? "icon" : place === "panel" ? "lg" : "sm"}
        title={place === "bar" ? "Batch variations" : undefined}
        type="button"
        variant="outline"
      >
        <LayersIcon />
        {place !== "bar" && "Variations"}
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
        <div className="grid gap-2.5">
          {action}
          {trigger}
        </div>
      ) : place === "bar" ? (
        <div className="flex shrink-0 items-center gap-2">
          {trigger}
          {action}
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

/**
 * The batch dialog: what varies (two or four seeds, or two to six characters), what stays the
 * same, each item's effective inputs, the generations it needs against what the access code has
 * left, and Render, which admits the batch and opens its page (`/batches/:id`). The request key
 * belongs to the exact batch asked for: asking again for it (a lost answer, a second click)
 * returns the batch already admitted. A request this tab sent for the shot without getting its
 * batch (`recallPending`: the answer was lost, the dialog closed, the page reloaded) opens the
 * dialog on that request again, under its key, rather than on fresh seeds.
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

  const variation: BatchVariation =
    kind === "seeds" ? { kind, seeds: seeds.slice(0, count) } : { characters: chosen, kind };

  const resending = sent !== undefined && variationKey(sent) === variationKey(variation);

  const valid =
    kind === "seeds"
      ? draft.character !== undefined
      : chosen.length >= MIN_CHARACTERS && chosen.length <= MAX_CHARACTERS;

  const items = valid ? planItems(draft, variation) : [];
  const size = kind === "seeds" ? count : chosen.length;
  // What the code has left is shown, not enforced: only new takes are charged, and only the
  // server knows which takes are already rendered, so its atomic admission decides.
  const remaining = reads.kind === "ready" ? reads.allowance.remaining : null;
  const beyond = remaining !== null && remaining < size;

  const togglePick = (id: string) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((each) => each !== id)
        : current.length < MAX_CHARACTERS
          ? [...current, id]
          : current,
    );

  async function submit() {
    const identity = variationKey(variation);
    const requestKey = keys.current.get(identity) ?? crypto.randomUUID();

    keys.current.set(identity, requestKey);
    // Recorded before it is sent: an answer that never arrives leaves the request to send again.
    rememberPending(draft, variation, requestKey);
    setSubmitting(true);
    setRefusal(null);

    const result = await postBatch({ shot: draft, variation }, requestKey);

    if ("data" in result) {
      forgetPending(draft);
      await navigate({ params: { batchId: result.data.id }, to: "/batches/$batchId" });

      return;
    }

    // A refusal with the app's reason is an answer: nothing was admitted (admission is atomic).
    // Without one (no answer, a gateway's error) the batch may exist, so the request stays.
    if (result.refusal.reason !== undefined) {
      forgetPending(draft);
    }

    setSubmitting(false);
    setRefusal(result.refusal);
  }

  const characterLabel = (id: string | undefined) => {
    const character = id ? byId.get(id) : undefined;

    return character ? characterName(character) : "The picked character";
  };

  return (
    <DialogContent size="lg">
      <DialogHeader>
        <Hud>Batch</Hud>
        <DialogTitle>Render variations</DialogTitle>
        <DialogDescription>
          Several takes of this shot at once. They render in line on the server, so you can close
          the page and come back to compare them.
        </DialogDescription>
      </DialogHeader>

      {reads.kind === "loading" && (
        <p className="text-sm text-muted-foreground" role="status">
          Loading your allowance and characters…
        </p>
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
        <p className="text-sm text-destructive-foreground" role="alert">
          {reads.refusal.message}
        </p>
      )}

      {reads.kind === "ready" && (
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2.5">
            <legend className="pb-2.5 text-sm font-medium">Vary</legend>
            <ToggleGroup
              aria-label="What to vary"
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
              <ToggleGroupItem value="seeds">
                <DicesIcon aria-hidden="true" />
                Seeds
              </ToggleGroupItem>
              <ToggleGroupItem value="characters">
                <LayersIcon aria-hidden="true" />
                Characters
              </ToggleGroupItem>
            </ToggleGroup>
          </fieldset>

          {kind === "seeds" ? (
            <div className="flex flex-wrap items-center gap-3">
              <ToggleGroup
                aria-label="How many takes"
                onValueChange={(value) => {
                  if (value) {
                    setCount(Number(value));
                  }
                }}
                spacing={1}
                type="single"
                value={String(count)}
                variant="segmented"
              >
                {SEED_COUNTS.map((each) => (
                  <ToggleGroupItem key={each} value={String(each)}>
                    {each} takes
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Button
                onClick={() => setSeeds(randomSeeds(seeds.length))}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ShuffleIcon />
                New seeds
              </Button>
            </div>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="pb-2 text-sm text-soft-foreground">
                Pick {MIN_CHARACTERS} to {MAX_CHARACTERS} characters ({chosen.length} picked)
              </legend>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {characters.map((character) => {
                  const on = picked.includes(character.id);

                  return (
                    <li key={character.id}>
                      <button
                        aria-pressed={on}
                        className={cn(
                          "relative block aspect-3/4 w-full cursor-pointer overflow-hidden rounded-xl border-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40",
                          on ? "border-brand" : "border-transparent",
                        )}
                        disabled={!on && chosen.length >= MAX_CHARACTERS}
                        onClick={() => togglePick(character.id)}
                        type="button"
                      >
                        <img
                          alt={characterAlt(character)}
                          className="absolute inset-0 size-full object-cover"
                          src={mediaUrl(character.image)}
                        />
                        <span className="absolute inset-x-0 bottom-0 truncate bg-background/75 px-1.5 py-1 text-left text-xs">
                          {characterName(character)}
                        </span>
                        {on && (
                          <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-brand text-primary-foreground">
                            <CheckIcon aria-hidden="true" className="size-3.5" />
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          <section
            aria-labelledby="batch-inputs"
            className="flex flex-col gap-2.5 rounded-2xl border p-4"
          >
            <h3 className="text-sm font-medium" id="batch-inputs">
              {valid
                ? `${size} takes, same motion and look`
                : kind === "seeds"
                  ? "Pick a character first"
                  : `Pick at least ${MIN_CHARACTERS} characters`}
            </h3>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted-foreground">Look</dt>
                <dd className="line-clamp-2 min-w-0 text-soft-foreground">{lookLabel(draft)}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted-foreground">
                  {kind === "seeds" ? "Character" : "Seed"}
                </dt>
                <dd className="min-w-0 text-soft-foreground">
                  {kind === "seeds" ? characterLabel(draft.character) : seedLabel(draft)}
                </dd>
              </div>
            </dl>
            {items.length > 0 && (
              <ol aria-label="Takes" className="flex flex-col gap-1 text-sm">
                {items.map((item, index) => (
                  <li className="flex gap-3" key={JSON.stringify(item.variation)}>
                    <span className="w-20 shrink-0 text-muted-foreground">Take {index + 1}</span>
                    <span className="min-w-0 truncate tabular-nums">
                      {"seed" in item.variation
                        ? `Seed ${item.variation.seed}`
                        : characterLabel(item.variation.character_id)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <p
              className={cn("text-sm", beyond ? "text-warning-foreground" : "text-soft-foreground")}
            >
              {beyond
                ? `Up to ${size} generations, and your access code has ${remaining} left. A take already rendered with the same recipe comes back free, so the batch starts if its new takes fit; otherwise nothing starts.`
                : `Uses up to ${size} of the ${remaining} generations your access code has left. A take already rendered with the same recipe comes back free.`}
            </p>
          </section>

          {refusal ? (
            <p className="text-sm text-destructive-foreground" role="alert">
              {refusal.message}
            </p>
          ) : (
            resending && (
              <p className="text-sm text-soft-foreground" role="status">
                These are the takes you last asked for, which got no answer. Render asks again with
                the same request: a batch it already started opens instead of starting twice.
              </p>
            )
          )}
        </div>
      )}

      <DialogFooter>
        <Button
          disabled={reads.kind !== "ready" || !valid || submitting}
          onClick={() => void submit()}
          type="button"
          variant="photon"
        >
          <LayersIcon />
          {submitting ? "Starting…" : `Render ${size} ${size === 1 ? "take" : "takes"}`}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
