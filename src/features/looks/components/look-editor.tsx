import { cn } from "cn";
import { CheckIcon, InfoIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { Fragment, useId, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import {
  type LookGroup,
  lookCatalog,
  lookGroups,
  type LookOption,
  type ReliableLookOption,
} from "#/features/looks/catalog";
import { lookPreviews } from "#/features/looks/components/previews";
import {
  composeLook,
  type Look,
  editDescription,
  pickedOptions,
  pickOption,
  readLook,
  removeGroup,
} from "#/features/looks/compose";
import type { DirectionEditorProps } from "#/features/motionTransfer/api";
import { Viewfinder } from "#/shared/components/brand";

/** The longest look `POST /api/generate` takes, once trimmed. */
const MAX_LOOK = 500;

/** Whether the benchmark showed `option`'s effect: such an option gets a preview tile. */
function isReliable(option: (typeof lookCatalog.options)[number]): option is ReliableLookOption {
  return option.evidence === "reliable";
}

const groupCopy: Record<LookGroup, { hint: string; title: string }> = {
  background: { hint: "the scene behind the character", title: "Background" },
  lighting: { hint: "one at a time", title: "Lighting" },
  look: { hint: "one at a time", title: "Color & style" },
};

/**
 * The look as the editor holds it: the prompt it last saw or wrote, and that prompt read as a
 * description and picks. Kept, rather than read again on every render, so the description shows
 * exactly as typed even where reading the prompt back would be ambiguous (blank space, a
 * description that is one of the leading sentences).
 */
type Held = { look: Look; prompt: string };

/**
 * The Direct step's direction editor (`DirectionEditorProps`), mounted in `src/app/composer-slots.ts`:
 * the visitor's own description and curated backgrounds, lighting and color/style looks from the
 * catalog (`catalog.ts`), composed into the one prompt the direction carries (`composeLook`). It
 * previews that prompt, and resets it to the workflow's default (a blank look). The picks live in
 * the prompt, which the wizard keeps in its URL, so a reload or a step change keeps them.
 */
export function LookEditor({ errors, onChange, value }: DirectionEditorProps) {
  const id = useId();
  const { prompt } = value;
  const [held, setHeld] = useState<Held>(() => ({ look: readLook(prompt), prompt }));
  const [notice, setNotice] = useState("");

  let { look } = held;

  // A prompt the editor did not write (a reset elsewhere, Back) is read afresh.
  if (held.prompt !== prompt) {
    look = composeLook(held.look) === prompt ? held.look : readLook(prompt);
    setHeld({ look, prompt });
  }

  const write = (next: Look, said = "") => {
    const nextPrompt = composeLook(next);

    setHeld({ look: next, prompt: nextPrompt });
    setNotice(said);
    onChange({ ...value, prompt: nextPrompt });
  };

  const picked = pickedOptions(look.selection);

  // A catalog fragment typed or pasted into the description becomes its pick; a background one
  // takes the place of the other background sentences of the text.
  const describe = (text: string) => {
    const { dropped, found, look: next, replaced } = editDescription(look, text);

    write(
      next,
      [
        ...found.map(({ group, label }) =>
          group === "background" && replaced.length > 0
            ? `${label} picked from your words, in place of the other background in them.`
            : `${label} picked from your words.`,
        ),
        ...dropped.map(({ label }) => `${label} removed: it does not combine with your words.`),
      ].join(" "),
    );
  };

  const toggle = (option: LookOption) => {
    if (look.selection[option.group] === option.id) {
      write(removeGroup(look, option.group), `${option.label} removed.`);

      return;
    }

    const { dropped, look: next, replaced } = pickOption(look, option.id);
    const before = picked.find(({ group }) => group === option.group);

    const said = [
      before
        ? `${option.label} replaced ${before.label}.`
        : replaced.length > 0
          ? `${option.label} replaced the background of the look.`
          : `${option.label} added.`,
      ...dropped.map(({ label }) => `${label} removed: it does not combine with ${option.label}.`),
    ];

    write(next, said.join(" "));
  };

  const tooLong = prompt.trim().length > MAX_LOOK;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <label className="font-display text-xl font-semibold" htmlFor={`${id}-description`}>
            Look{" "}
            <span className="font-sans text-sm font-normal text-muted-foreground">
              · your own words for the character and scene, optional
            </span>
          </label>
          <span
            className={tooLong ? "hud text-destructive-foreground" : "hud text-muted-foreground"}
            id={`${id}-count`}
          >
            {prompt.trim().length} / {MAX_LOOK}
          </span>
        </div>
        <Textarea
          aria-describedby={`${id}-count`}
          aria-invalid={errors.includes("prompt")}
          id={`${id}-description`}
          onChange={(event) => describe(event.target.value)}
          placeholder="Keep the character and the background from the photo."
          value={look.description}
        />
      </div>

      {lookGroups.map((group) => {
        const options = lookCatalog.options.filter((option) => option.group === group);
        const reliable = options.filter(isReliable);
        const experimental = options.filter((option) => !isReliable(option));
        const allExperimental = reliable.length === 0;

        return (
          <section aria-labelledby={`${id}-${group}`} className="flex flex-col gap-3" key={group}>
            <div className="flex flex-col gap-1.5">
              <h3
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold"
                id={`${id}-${group}`}
              >
                {groupCopy[group].title}
                <span className="text-sm font-normal text-muted-foreground">
                  · {groupCopy[group].hint}
                </span>
                {allExperimental && <Badge variant="warning">Experimental</Badge>}
              </h3>
              {allExperimental && (
                <p className="text-sm text-muted-foreground">
                  In our benchmark these did not visibly change the take: Wan Animate 2 keeps the
                  light and colors of the photo. In the same test, a background change brought its
                  own light.
                </p>
              )}
            </div>
            <div aria-labelledby={`${id}-${group}`} className="flex flex-col gap-3" role="group">
              {reliable.length > 0 && (
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3">
                  {reliable.map((option) => (
                    <LookTile
                      describedBy={`${id}-${option.id}`}
                      key={option.id}
                      onToggle={() => toggle(option)}
                      option={option}
                      picked={look.selection[group] === option.id}
                      preview={lookPreviews[option.id]}
                    />
                  ))}
                </div>
              )}
              {experimental.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {experimental.map((option) => (
                    <Fragment key={option.id}>
                      <Button
                        aria-describedby={`${id}-${option.id}`}
                        aria-pressed={look.selection[group] === option.id}
                        onClick={() => toggle(option)}
                        size="sm"
                        type="button"
                        variant="chip"
                      >
                        {option.label}
                      </Button>
                      <span className="sr-only" id={`${id}-${option.id}`}>
                        {option.description} Experimental: no visible effect in our benchmark.
                      </span>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          </section>
        );
      })}

      <section
        aria-labelledby={`${id}-effective`}
        className="flex flex-col gap-3 rounded-2xl border bg-foreground/3 p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold" id={`${id}-effective`}>
            Effective direction
          </h3>
          <Button
            disabled={prompt === ""}
            onClick={() => write({ description: "", selection: {} }, "Look reset to the default.")}
            size="sm"
            type="button"
            variant="outline"
          >
            <RotateCcwIcon aria-hidden="true" />
            Reset to default
          </Button>
        </div>
        {picked.length > 0 && (
          <ul aria-label="Your picks" className="flex flex-wrap gap-2">
            {picked.map((option) => (
              <li key={option.id}>
                <Button
                  aria-label={`Remove ${option.label}`}
                  onClick={() => toggle(option)}
                  size="sm"
                  type="button"
                  variant="chip"
                >
                  {option.label}
                  <XIcon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p
          aria-label="Prompt sent"
          className="text-sm wrap-break-word whitespace-pre-wrap text-soft-foreground"
        >
          {prompt.trim() === ""
            ? "The workflow's default: the character and the background as in the photo."
            : prompt}
        </p>
        <p className="flex gap-2 text-sm text-muted-foreground">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            Looks are prompt guidance for Wan Animate 2. In our benchmark (one character, one clip),
            a background replaced the photo's; lighting and color did not visibly change the take.
            The camera, the framing and the pose follow your motion clip: no option changes the
            camera angle. The character keeps the photo's face and outfit.
          </span>
        </p>
        <p aria-live="polite" className="sr-only" role="status">
          {notice}
        </p>
      </section>
    </div>
  );
}

/** One catalog option: a toggle tile with its benchmark still, label and description. */
function LookTile({
  describedBy,
  onToggle,
  option,
  picked,
  preview,
}: {
  describedBy: string;
  onToggle: () => void;
  option: LookOption;
  picked: boolean;
  preview: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <button
        aria-describedby={describedBy}
        aria-pressed={picked}
        className={cn(
          "relative block aspect-4/5 w-full cursor-pointer overflow-hidden rounded-xl border bg-card text-left text-foreground transition hover:-translate-y-0.5 hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
          picked && "border-transparent shadow-picked hover:border-transparent",
        )}
        onClick={onToggle}
        type="button"
      >
        <img
          alt=""
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          src={preview}
        />
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-b from-transparent to-background/95"
        />
        {picked && (
          <>
            <Viewfinder className="inset-2" tone="brand" />
            <span
              aria-hidden="true"
              className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-brand text-primary-foreground shadow-glow"
            >
              <CheckIcon className="size-3.5" strokeWidth={3} />
            </span>
          </>
        )}
        <span className="absolute inset-x-2.5 bottom-2 text-sm leading-tight font-semibold">
          {option.label}
        </span>
      </button>
      <p className="text-xs text-muted-foreground" id={describedBy}>
        {option.description}
      </p>
    </div>
  );
}
