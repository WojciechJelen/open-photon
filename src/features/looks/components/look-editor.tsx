import {
  ChevronDownIcon,
  ImageIcon,
  InfoIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { Fragment, useId, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import {
  lookCatalog,
  type LookGroup,
  type LookOption,
  type ReliableLookOption,
} from "#/features/looks/catalog";
import { lookPreviews } from "#/features/looks/components/previews";
import {
  composeLook,
  editDescription,
  type Look,
  pickedOptions,
  pickOption,
  readLook,
  removeGroup,
} from "#/features/looks/compose";
import type { DirectionEditorProps } from "#/features/motionTransfer/api";
import { PictureTile } from "#/shared/components/picture-tile";
import { ToolSection } from "#/shared/components/tool-layout";

/** The longest look `POST /api/generate` takes, once trimmed. */
const MAX_LOOK = 500;

/** Whether the benchmark showed `option`'s effect: such an option gets a preview tile. */
function isReliable(option: (typeof lookCatalog.options)[number]): option is ReliableLookOption {
  return option.evidence === "reliable";
}

/** The groups past the background, none of which the benchmark backed up (`catalog.ts`). */
const refinements: { group: LookGroup; title: string }[] = [
  { group: "lighting", title: "Lighting" },
  { group: "look", title: "Color & style" },
];

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
 * the prompt, which the wizard keeps in its URL, so a reload or a step change keeps them. With a
 * `seedField` the words and backgrounds show and the rest folds under an Advanced row, which names
 * what is set inside it; without one, inside a page's own fold, it all shows. A closed fold stays
 * mounted: the prompt it previews is still the page's to read.
 */
export function LookEditor({
  characterImage,
  characterImageAlt = "",
  errors,
  onChange,
  seedField,
  value,
}: DirectionEditorProps) {
  const id = useId();
  const { prompt, seed } = value;
  const [held, setHeld] = useState<Held>(() => ({ look: readLook(prompt), prompt }));
  const [notice, setNotice] = useState("");
  const [advanced, setAdvanced] = useState(false);

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
  const background = picked.find(({ group }) => group === "background");

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

  const count = prompt.trim().length;

  const words = (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={`${id}-description`}>Your own words</Label>
        <span
          className={
            count === 0
              ? "invisible type-caption"
              : count > MAX_LOOK
                ? "type-caption text-destructive-foreground tabular-nums"
                : "type-caption text-muted-foreground tabular-nums"
          }
          id={`${id}-count`}
        >
          {count} / {MAX_LOOK}
        </span>
      </div>
      <Textarea
        aria-describedby={`${id}-count`}
        aria-invalid={errors.includes("prompt")}
        aria-label="Look, in your own words"
        id={`${id}-description`}
        onChange={(event) => describe(event.target.value)}
        placeholder="Keep the character and the background from the photo."
        rows={3}
        value={look.description}
      />
    </div>
  );

  const details = (
    <>
      {refinements.map(({ group, title }) => {
        const options = lookCatalog.options.filter((option) => option.group === group);

        return (
          <section aria-labelledby={`${id}-${group}`} className="flex flex-col gap-3" key={group}>
            <h3
              className="flex min-w-0 flex-wrap items-center gap-2 type-label wrap-anywhere"
              id={`${id}-${group}`}
            >
              {title}
              <Badge variant="warning">Experimental</Badge>
            </h3>
            <div aria-labelledby={`${id}-${group}`} className="flex flex-wrap gap-2" role="group">
              {options.map((option) => (
                <Fragment key={option.id}>
                  <Button
                    aria-describedby={`${id}-${option.id}`}
                    aria-pressed={look.selection[group] === option.id}
                    onClick={() => toggle(option)}
                    size="sm"
                    title={option.description}
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
          </section>
        );
      })}

      {seedField}

      <section aria-labelledby={`${id}-effective`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="min-w-0 type-label wrap-anywhere" id={`${id}-effective`}>
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
          className="type-caption wrap-anywhere whitespace-pre-wrap text-soft-foreground"
        >
          {prompt.trim() === ""
            ? "The workflow's default: the character and the background as in the photo."
            : prompt}
        </p>
        <p className="flex gap-2 type-caption text-muted-foreground">
          <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 wrap-anywhere">
            Looks are prompt guidance for Wan Animate 2. In our benchmark (one character, one clip),
            a background replaced the photo's; lighting and color did not visibly change the take.
            The camera, the framing and the pose follow your motion clip: no option changes the
            camera angle. The character keeps the photo's face and outfit.
          </span>
        </p>
      </section>
    </>
  );

  // What is set under the closed row: nothing in it should pass unseen.
  const inside = [
    ...picked.filter(({ group }) => group !== "background").map(({ label }) => label),
    ...(seed.trim() === "" ? [] : [`Seed: ${seed.trim()}`]),
  ].join(" · ");

  return (
    <>
      {seedField ? (
        <ToolSection
          end={
            <span className="max-w-full type-caption wrap-anywhere text-muted-foreground">
              Optional
            </span>
          }
          title="Look"
        >
          {words}
        </ToolSection>
      ) : (
        words
      )}

      <ToolSection title="Background">
        <div aria-label="Background" className="grid tiles-fill-40 gap-3" role="group">
          {characterImage !== undefined && (
            <PictureTile
              alt={characterImageAlt}
              aria-label="From the photo"
              aspect="aspect-4/5"
              caption="From the photo"
              onClick={() => background && toggle(background)}
              position="object-top"
              pressed={background === undefined}
              ringOnly
              src={characterImage ?? undefined}
            >
              {characterImage === null ? (
                <span className="absolute inset-0 grid place-items-center text-muted-foreground">
                  <ImageIcon aria-hidden="true" className="size-6" strokeWidth={1.75} />
                </span>
              ) : undefined}
            </PictureTile>
          )}
          {lookCatalog.options
            .filter((option) => option.group === "background")
            .filter(isReliable)
            .map((option) => (
              <Fragment key={option.id}>
                <PictureTile
                  alt="AI-generated image"
                  aria-describedby={`${id}-${option.id}`}
                  aria-label={option.label}
                  aspect="aspect-4/5"
                  caption={option.label}
                  onClick={() => toggle(option)}
                  pressed={look.selection.background === option.id}
                  ringOnly
                  src={lookPreviews[option.id]}
                  title={option.description}
                />
                <span className="sr-only" id={`${id}-${option.id}`}>
                  {option.description} The preview is AI-generated.
                </span>
              </Fragment>
            ))}
        </div>
      </ToolSection>

      {seedField ? (
        <div className="rounded-xl border bg-card/72">
          <Collapsible onOpenChange={setAdvanced} open={advanced}>
            <CollapsibleTrigger asChild>
              <button
                className="group flex h-13.5 w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-5 text-left type-label focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                type="button"
              >
                <span className="inline-flex max-w-1/2 min-w-0 shrink-0 items-center gap-2.5">
                  <SlidersHorizontalIcon
                    aria-hidden="true"
                    className="size-4 shrink-0"
                    strokeWidth={1.75}
                  />
                  <span className="truncate">Advanced</span>
                </span>
                <span className="inline-flex min-w-0 items-center gap-2 font-normal text-muted-foreground">
                  <span className="truncate" title={inside || undefined}>
                    {inside || "Lighting, color and seed"}
                  </span>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className="size-3.5 shrink-0 transition-transform group-aria-expanded:rotate-180"
                  />
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent forceMount hidden={!advanced}>
              <div className="flex flex-col gap-6 px-5 pt-2 pb-5">{details}</div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : (
        details
      )}

      <p aria-live="polite" className="sr-only" role="status">
        {notice}
      </p>
    </>
  );
}
