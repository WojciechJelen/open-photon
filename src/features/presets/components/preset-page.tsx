import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, ExternalLinkIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { type ComponentType, useEffect, useId, useState } from "react";

import { Button } from "#/components/ui/button";
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
  presetDirection,
  presetDraft,
  type PresetSearch,
} from "#/features/presets/draft";
import { presetFieldMessages, usePresetGenerate } from "#/features/presets/use-preset-generate";
import { AccessCodeDialog, AccessStatus } from "#/shared/components/access-code-dialog";
import { Hud, PageGlow } from "#/shared/components/brand";
import { SiteHeader } from "#/shared/components/site";
import { useAccessCode } from "#/shared/use-access-code";

/** What the page needs of Motion Transfer's selection data (`loadSelection`). */
export type PresetSelection = {
  character: PickableCharacter | null;
  characters: PickableCharacter[];
  sampleTakeId: string | null;
  signedIn: boolean;
};

const notice =
  "flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between";

/** Where the example and the inputs come from, with their licences. */
function Credits({ preset }: { preset: Preset }) {
  return (
    <section aria-labelledby="preset-credits" className="flex flex-col gap-2 text-sm">
      <h2 className="font-semibold" id="preset-credits">
        Credits
      </h2>
      <Facts
        items={[
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
    </section>
  );
}

/**
 * A preset's page at `/presets/:presetId`: its example take (`PresetPlayer`), what it sets, and
 * the shot as Motion Transfer's draft (`presetDraft`), finished here: the character (the
 * composer's `characterPicker`, so the library, uploads with consent and the samples), the look
 * (`directionEditor`) and the seed, prefilled with the preset's and editable, then Generate, which
 * submits it through the preset's endpoint and opens the take at `/g/:id`. "Open in Motion
 * Transfer" hands the same draft to the wizard instead (`draftHref`). The choices live in the
 * URL (`search`, changed through `onSearch`), so a reload keeps them; opening the page never
 * generates. A link made for another version of the preset (`search.version`) or a preset this
 * server cannot render says so, and Generate waits.
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
  const { errors, failure, pending, submit } = usePresetGenerate(preset, access.hold);
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

  return (
    <div className="relative isolate">
      <PageGlow />
      <SiteHeader category="Video">
        <AccessStatus onOpen={access.unlock} signedIn={selection.signedIn} />
      </SiteHeader>
      <main className="mx-auto grid w-full max-w-330 gap-x-10 gap-y-9 px-4 pt-8 pb-24 sm:px-8 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-7 lg:col-start-6 lg:row-start-1">
          <div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/presets">
                <ArrowLeftIcon aria-hidden="true" />
                All presets
              </Link>
            </Button>
          </div>
          <Hud>
            Motion preset · version {preset.version} · {preset.workflow.id} v
            {preset.workflow.version}
          </Hud>
          <h1 className="font-display text-4xl leading-tight font-bold tracking-display sm:text-5xl">
            {preset.title}
          </h1>
          <p className="text-base text-soft-foreground">{preset.summary}</p>
          <Facts
            items={[
              ["Motion", preset.motion.title],
              ["Look", preset.defaults.prompt],
              ["Seed", preset.defaults.seed],
              ["You add", "A character"],
            ]}
          />
        </div>

        <div className="mx-auto w-full max-w-xs min-w-0 lg:sticky lg:top-6 lg:col-span-5 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:max-w-none lg:self-start">
          <PresetPlayer preset={preset} />
        </div>

        <div className="flex min-w-0 flex-col gap-9 lg:col-span-7 lg:col-start-6">
          {!ready && (
            <div
              className={`${notice} border-destructive/40 bg-destructive/6 text-destructive-foreground`}
              data-reason={availability.reason}
              role="alert"
            >
              <span className="flex items-start gap-2">
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
              <span>
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

          <section aria-labelledby={`${id}-character`} className="flex flex-col gap-4">
            <h2 className="font-display text-2xl font-semibold" id={`${id}-character`}>
              1 · Add your character
            </h2>
            <p className="text-sm text-soft-foreground">
              Pick a sample, one from the library, or upload a photo you have the right to use.
            </p>
            <CharacterPicker
              character={selection.character}
              characterId={search.character}
              characters={selection.characters}
              draft={snapshotDraft({ ...draft, character: undefined })}
              hold={access.hold}
              onPick={(character) => onSearch({ character })}
              release={access.release}
              signedIn={selection.signedIn}
            />
          </section>

          <form
            aria-labelledby={`${id}-direct`}
            className="flex flex-col gap-6"
            id={formId}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submit(search.character, direction);
            }}
          >
            <h2 className="font-display text-2xl font-semibold" id={`${id}-direct`}>
              2 · Adjust the shot{" "}
              <span className="text-base font-normal text-muted-foreground">· optional</span>
            </h2>
            <DirectionEditor
              errors={errors}
              onChange={(next) => {
                setDirection(next);
                onSearch(directionSearch(preset, next));
              }}
              value={direction}
            />
            <div className="flex max-w-xs flex-col gap-2">
              <Label htmlFor={`${id}-seed`}>Seed</Label>
              <Input
                aria-describedby={`${id}-seed-hint`}
                aria-invalid={errors.includes("seed")}
                id={`${id}-seed`}
                inputMode="numeric"
                onChange={(event) => {
                  const next = { ...direction, seed: event.target.value };

                  setDirection(next);
                  onSearch(directionSearch(preset, next));
                }}
                placeholder="Default"
                value={direction.seed}
              />
              <p className="text-sm text-muted-foreground" id={`${id}-seed-hint`}>
                The preset&apos;s seed made its example. Blank is Motion Transfer&apos;s fixed
                default.
              </p>
            </div>

            {errors.length > 0 && (
              <ul
                aria-label="Problems with the shot"
                className="flex flex-col gap-1 rounded-xl border border-destructive/40 bg-destructive/6 px-4 py-3 text-sm text-destructive-foreground"
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
                role="alert"
              >
                <span>{failure.message}</span>
                {failure.reason === "preset_stale" && (
                  <Button onClick={() => void router.invalidate()} size="sm" variant="outline">
                    Reload the preset
                  </Button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <Button
                disabled={!ready || stale || pending}
                size="lg"
                type="submit"
                variant="photon"
              >
                <SparklesIcon aria-hidden="true" />
                {pending ? "Starting…" : "Generate"}
              </Button>
              {draft && (
                <Button asChild variant="outline">
                  <a href={draftHref(draft)}>
                    <ExternalLinkIcon aria-hidden="true" />
                    Open in Motion Transfer
                  </a>
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Generate renders one take of this preset with your character, in about a minute and a
              half. Opening a preset never renders anything.
            </p>
          </form>

          <Credits preset={preset} />
        </div>
      </main>
      <AccessCodeDialog {...access.dialog} sampleTakeId={selection.sampleTakeId} />
    </div>
  );
}
