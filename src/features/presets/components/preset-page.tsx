import { Link, useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  PaletteIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import type { PickableCharacter } from "#/features/characters";
import {
  type CharacterPickerProps,
  type DirectionEditorProps,
  draftHref,
  snapshotDraft,
} from "#/features/motionTransfer/api";
import type { Preset } from "#/features/presets/catalog";
import { Facts } from "#/features/presets/components/facts";
import { PresetPlayer } from "#/features/presets/components/preset-player";
import type { PresetView } from "#/features/presets/contracts";
import {
  directionSearch,
  lookSummary,
  presetDirection,
  presetDraft,
  type PresetSearch,
  reconciledDirection,
} from "#/features/presets/draft";
import { previewUrl } from "#/features/presets/previews";
import { presetFieldMessages, usePresetGenerate } from "#/features/presets/use-preset-generate";
import { AccessCodeDialog } from "#/shared/components/access-code-dialog";
import { PageHeading } from "#/shared/components/page-heading";
import { Panel } from "#/shared/components/panel";
import { SitePage } from "#/shared/components/site";
import { StableText } from "#/shared/components/stable-text";
import { ToolSection } from "#/shared/components/tool-layout";
import { useAccessCode } from "#/shared/use-access-code";

/** What the page needs of Motion Transfer's selection data (`loadSelection`). */
export type PresetSelection = {
  character: PickableCharacter | null;
  characters: PickableCharacter[];
  sampleTakeId: string | null;
  signedIn: boolean;
};

const notice =
  "flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm wrap-anywhere sm:flex-row sm:items-center sm:justify-between";

/** Brings a refusal into view as it appears: Generate may sit on the screen's last line. */
function revealRefusal(element: HTMLElement | null) {
  element?.scrollIntoView({ block: "nearest" });
}

/** The preset's version, and where the example and the inputs come from, with their licences. */
function Credits({ preset }: { preset: Preset }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="inline" type="button" variant="link">
          <span>Credits</span>
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Credits</DialogTitle>
          <DialogDescription>Where this preset and its example come from.</DialogDescription>
        </DialogHeader>
        <Facts
          items={[
            [
              "Preset",
              `Version ${preset.version}, ${preset.workflow.id} v${preset.workflow.version}`,
            ],
            [
              "Motion",
              `${preset.motion.title}, ${preset.motion.license}: ${preset.motion.attribution}`,
            ],
            [
              "Example character",
              `${preset.example.character.title}, ${preset.example.character.license}`,
            ],
            ["Example render", preset.example.render],
          ]}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The shot's look as one row: what it comes to (`lookSummary`), with the example's frame while it
 * is the preset's own. `action` opens the controls that change it.
 */
function LookRow({
  action,
  preset,
  prompt,
}: {
  action: ReactNode;
  preset: Preset;
  prompt: string;
}) {
  const { caption, own, title } = lookSummary(preset, prompt);

  return (
    <Panel className="flex-row items-center justify-between gap-3 py-3 pr-3 pl-4 max-sm:min-h-21.25">
      <div className="flex min-w-0 items-center gap-3">
        {own ? (
          <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-thumb border border-dashed border-edge-strong text-muted-foreground">
            <PaletteIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </span>
        ) : (
          <span className="relative block h-14 w-11 shrink-0 overflow-hidden rounded-thumb bg-screen">
            <img
              alt="An AI-generated frame of this preset's example"
              className="absolute inset-0 size-full object-cover"
              src={previewUrl(preset.example.poster)}
            />
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span
            className="line-clamp-2 text-sm font-semibold wrap-anywhere sm:line-clamp-1"
            title={title}
          >
            {title}
          </span>
          <span className="truncate type-caption text-muted-foreground">{caption}</span>
        </div>
      </div>
      <div className="max-w-1/2 shrink-0 pr-2">{action}</div>
    </Panel>
  );
}

/**
 * A preset's page at `/presets/:presetId`: its example take (`PresetPlayer`), what it sets, and
 * the shot as Motion Transfer's draft (`presetDraft`), finished here: the character (the
 * composer's `characterPicker`, which is its whole section: the library, uploads with consent and
 * the samples), the look
 * (one row, with `directionEditor` and the seed under its Adjust; they stay mounted, and open by
 * themselves when Generate finds one wrong), prefilled with the preset's and editable, then
 * Generate, which submits it through the preset's endpoint and opens the take at `/g/:id`. "Open in
 * Motion Transfer" hands the same draft to the wizard instead (`draftHref`). The choices live in
 * the URL (`search`, changed through `onSearch`), so a reload keeps them; opening the page never
 * generates. A link made for another version of the preset (`search.version`) or a preset this
 * server cannot render says so, and Generate waits. What Generate refuses shows in a slot under its
 * row, the last on the page, so it moves nothing, and goes once the visitor fixes it.
 */
export function PresetPage({
  characterPicker: CharacterPicker,
  directionEditor: DirectionEditor,
  onSearch,
  search,
  selection,
  view: { availability, preset },
}: {
  characterPicker: ComponentType<CharacterPickerProps>;
  directionEditor: ComponentType<DirectionEditorProps>;
  onSearch: (next: Partial<PresetSearch>) => void;
  search: PresetSearch;
  selection: PresetSelection;
  view: PresetView;
}) {
  const id = useId();
  const formId = `${id}-form`;
  const router = useRouter();
  const access = useAccessCode();
  const [direction, setDirection] = useState(() => presetDirection(preset, search));
  // The direction searches this page's own edits asked for and the router has not shown yet.
  const ownSearches = useRef<string[]>([]);

  const { errors, failure, pending, submit } = usePresetGenerate(
    preset,
    search.character,
    direction,
    access.hold,
  );

  // A link or reload that carries a changed look or seed shows it.
  const [adjust, setAdjust] = useState(search.prompt !== undefined || search.seed !== undefined);
  const stale = search.version !== undefined && search.version !== preset.version;
  const ready = availability.status === "ready";
  const draft = ready ? presetDraft(preset, availability.motion, search) : null;

  // A link without a version is for the version shown: record it, so a reload after the catalog
  // changes says the preset changed instead of switching silently.
  useEffect(() => {
    if (search.version === undefined) {
      onSearch({ version: preset.version });
    }
  }, [onSearch, preset.version, search.version]);

  // The search or the preset changed under the form: an edit of the page's own arriving keeps
  // the form as typed; anything else (Back, Forward, a refreshed catalog) resets the form to it.
  const { prompt, seed } = search;

  useEffect(() => {
    const arrived = ownSearches.current.indexOf(JSON.stringify({ prompt, seed }));

    if (arrived !== -1) {
      ownSearches.current.splice(0, arrived + 1);

      return;
    }

    setDirection((current) => reconciledDirection(preset, { prompt, seed }, current));
  }, [preset, prompt, seed]);

  function edit(next: typeof direction) {
    const members = directionSearch(preset, next);

    setDirection(next);

    // Only a search that changes comes back through the effect above.
    if (members.prompt !== prompt || members.seed !== seed) {
      ownSearches.current.push(JSON.stringify({ prompt: members.prompt, seed: members.seed }));
      onSearch(members);
    }
  }

  return (
    <SitePage category="Video" gap={10} onAccess={access.unlock} top={10}>
      <div className="flex flex-wrap items-start gap-x-12 gap-y-8">
        <div className="mx-auto max-w-97.5 min-w-0 flex-1 basis-80 max-sm:max-w-70 lg:sticky lg:top-6">
          <PresetPlayer preset={preset} />
        </div>

        <div className="flex min-w-0 grow-999 basis-140 flex-col gap-8">
          <div className="flex flex-col gap-3">
            <Link
              className="-my-1.5 inline-flex h-11 w-fit items-center gap-1.5 rounded-sm type-caption font-medium text-soft-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
              to="/presets"
            >
              <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
              All presets
            </Link>
            <PageHeading subtitle={preset.summary} title={preset.title} />
          </div>

          {!ready && (
            <div
              className={`${notice} border-destructive/40 bg-destructive/6 text-destructive-foreground`}
              data-reason={availability.reason}
              role="alert"
            >
              <span className="flex min-w-0 items-start gap-2">
                <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {availability.message} Pick another preset, or start a shot in Motion Transfer.
              </span>
              <Button asChild size="sm" variant="outline">
                <Link to="/presets">All presets</Link>
              </Button>
            </div>
          )}

          {ready && stale && (
            <div
              className={`${notice} border-brand/40 bg-brand/8`}
              data-reason="preset_stale"
              role="alert"
            >
              <span className="min-w-0">
                This link was made for version {search.version} of the preset. The current version
                is {preset.version}; its look or seed may differ from what the link showed. Review
                it, then use it.
              </span>
              <Button
                onClick={() => onSearch({ version: preset.version })}
                size="sm"
                variant="outline"
              >
                Use version {preset.version}
              </Button>
            </div>
          )}

          <CharacterPicker
            character={selection.character}
            characterId={search.character}
            characters={selection.characters}
            draft={snapshotDraft({ ...draft, character: undefined })}
            hold={access.hold}
            number="01"
            onPick={(character) => onSearch({ character })}
            release={access.release}
            signedIn={selection.signedIn}
            title="Add your character"
          />

          <form
            aria-label="The shot"
            className="flex min-w-0 flex-col gap-8"
            id={formId}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();

              // A look or seed Generate refused has to be in view to be fixed.
              if (submit().some((field) => field !== "character_id")) {
                setAdjust(true);
              }
            }}
          >
            <ToolSection number="02" title="Look">
              <Collapsible onOpenChange={setAdjust} open={adjust}>
                <LookRow
                  action={
                    <CollapsibleTrigger asChild>
                      <Button size="inline" type="button" variant="ghost">
                        <span>Adjust</span>
                        <ChevronDownIcon
                          aria-hidden="true"
                          className={cn("size-3.5 transition-transform", adjust && "rotate-180")}
                        />
                      </Button>
                    </CollapsibleTrigger>
                  }
                  preset={preset}
                  prompt={direction.prompt}
                />
                <CollapsibleContent forceMount hidden={!adjust}>
                  <div className="flex flex-col gap-6 pt-6">
                    <DirectionEditor errors={errors} onChange={edit} value={direction} />
                    <div className="flex max-w-xs flex-col gap-2">
                      <Label htmlFor={`${id}-seed`}>Seed</Label>
                      <Input
                        aria-describedby={`${id}-seed-hint`}
                        aria-invalid={errors.includes("seed")}
                        id={`${id}-seed`}
                        inputMode="numeric"
                        onChange={(event) => edit({ ...direction, seed: event.target.value })}
                        placeholder="Default"
                        value={direction.seed}
                      />
                      <p className="type-hint text-muted-foreground" id={`${id}-seed-hint`}>
                        The preset&apos;s seed made its example. Blank is Motion Transfer&apos;s
                        fixed default.
                      </p>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </ToolSection>

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <Button disabled={!ready || stale || pending} type="submit" variant="photon">
                  <SparklesIcon aria-hidden="true" />
                  <StableText
                    current={pending ? "Starting…" : "Generate"}
                    labels={["Generate", "Starting…"]}
                  />
                </Button>
                {draft && (
                  <Button asChild variant="ghost">
                    <a href={draftHref(draft)}>Open in Motion Transfer</a>
                  </Button>
                )}
                <span className="-mr-1 ml-auto max-w-full">
                  <Credits preset={preset} />
                </span>
              </div>

              {/* The refusals' slot: a line of it fits the page's bottom padding, so it moves nothing. */}
              <div className="-mb-7 flex min-h-11.5 flex-col gap-3 sm:-mb-14.5">
                {errors.length > 0 && (
                  <ul
                    aria-label="Problems with the shot"
                    className="flex flex-col gap-1 rounded-xl border border-destructive/40 bg-destructive/6 px-4 py-3 text-sm wrap-anywhere text-destructive-foreground"
                    ref={revealRefusal}
                    role="alert"
                  >
                    {errors.map((field) => (
                      <li key={field}>{presetFieldMessages[field]}</li>
                    ))}
                  </ul>
                )}
                {failure && (
                  <div
                    className={`${notice} border-destructive/40 bg-destructive/6 text-destructive-foreground`}
                    data-reason={failure.reason}
                    ref={revealRefusal}
                    role="alert"
                  >
                    <span className="min-w-0">{failure.message}</span>
                    {failure.reason === "preset_stale" && (
                      <Button
                        onClick={() => void router.invalidate()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Reload the preset
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>

      <AccessCodeDialog {...access.dialog} sampleTakeId={selection.sampleTakeId} />
    </SitePage>
  );
}
