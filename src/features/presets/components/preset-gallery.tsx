import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import type { PresetView } from "#/features/presets/contracts";
import { previewUrl } from "#/features/presets/previews";
import { PageHeading } from "#/shared/components/page-heading";
import { SitePage } from "#/shared/components/site";

/**
 * One preset's card, a link as a whole: the poster of its example take (a still; the page plays it),
 * tagged AI-generated like every output, its title and summary. It opens the preset's page at the
 * version shown, and opening it never generates. A preset this server cannot render says so on its
 * poster; its page says why.
 */
function PresetCard({ view: { availability, preset } }: { view: PresetView }) {
  const headingId = `preset-${preset.id}`;
  const ready = availability.status === "ready";

  return (
    <article aria-labelledby={headingId} className="h-full">
      <Link
        aria-label={`Use this preset: ${preset.title}${ready ? "" : " (unavailable)"}`}
        className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-card/72 text-foreground transition-colors hover:border-edge-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
        params={{ presetId: preset.id }}
        search={{ version: preset.version }}
        to="/presets/$presetId"
      >
        <div className="relative aspect-4/5 shrink-0 overflow-hidden bg-screen">
          <img
            alt={`An AI-generated frame of the ${preset.title} example take: ${preset.example.character.title}, a sample character, performing it.`}
            className="absolute inset-0 size-full object-cover object-top"
            height={848}
            loading="lazy"
            src={previewUrl(preset.example.poster)}
            width={480}
          />
          <span className="absolute bottom-2 left-2 rounded-tag bg-background/66 px-1.75 py-0.75 type-tag text-foreground">
            AI-generated
          </span>
          {!ready && (
            <span className="absolute top-3 left-3">
              <Badge variant="solid">
                <TriangleAlertIcon aria-hidden="true" />
                Unavailable
              </Badge>
            </span>
          )}
        </div>
        <div className="flex flex-1 items-center justify-between gap-4 px-5 py-4.5">
          <div className="flex min-w-0 flex-col gap-1 self-start">
            <h2
              className="line-clamp-2 type-card-title wrap-anywhere"
              id={headingId}
              title={preset.title}
            >
              {preset.title}
            </h2>
            <p
              className="line-clamp-2 text-sm leading-normal wrap-anywhere text-soft-foreground"
              title={preset.summary}
            >
              {preset.summary}
            </p>
          </div>
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </span>
        </div>
      </Link>
    </article>
  );
}

/**
 * The preset gallery at `/presets`: every curated preset as a card, in catalog order. Each is a
 * ready-made Motion Transfer shot (a sample motion, a look and a seed) with a real example take;
 * the visitor adds a character on its page.
 */
export function PresetGallery({ presets }: { presets: PresetView[] }) {
  return (
    <SitePage category="Video" gap={7}>
      <PageHeading
        subtitle="Pick a preset, add your character and generate."
        title="Start from a ready-made shot"
      />
      <ul aria-label="Presets" className="grid grid-fit-75 gap-4">
        {presets.map((view) => (
          <li className="min-w-0" key={view.preset.id}>
            <PresetCard view={view} />
          </li>
        ))}
      </ul>
    </SitePage>
  );
}
