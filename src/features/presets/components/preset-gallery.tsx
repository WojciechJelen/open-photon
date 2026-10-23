import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Facts } from "#/features/presets/components/facts";
import type { PresetView } from "#/features/presets/contracts";
import { previewUrl } from "#/features/presets/previews";
import { Hud, PageGlow, StatusDot } from "#/shared/components/brand";
import { OpenWeightsBadge, SiteFooter, SiteHeader } from "#/shared/components/site";

/**
 * One preset's card: the poster of its example take (a still; the page plays it), what it sets,
 * and "Use this preset", which opens its page at the version shown. Opening it never generates.
 */
function PresetCard({ view: { availability, preset } }: { view: PresetView }) {
  const headingId = `preset-${preset.id}`;

  return (
    <article
      aria-labelledby={headingId}
      className="flex h-full flex-col overflow-hidden rounded-3xl border bg-linear-to-b from-foreground/4 to-foreground/1"
    >
      <div className="relative border-b">
        <img
          alt={`A frame of the ${preset.title} example take: ${preset.example.character.title}, a sample character, performing it.`}
          className="aspect-3/4 w-full object-cover"
          height={848}
          loading="lazy"
          src={previewUrl(preset.example.poster)}
          width={480}
        />
        <span className="absolute top-3 left-3">
          {availability.status === "ready" ? (
            <Badge variant="solid">
              <StatusDot tone="ok" />
              Ready
            </Badge>
          ) : (
            <Badge variant="solid">
              <TriangleAlertIcon aria-hidden="true" />
              Unavailable
            </Badge>
          )}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <h2 className="font-display text-2xl font-semibold" id={headingId}>
          {preset.title}
        </h2>
        <p className="text-sm text-soft-foreground">{preset.summary}</p>
        <Facts
          items={[
            ["Motion", preset.motion.title],
            ["You add", "A character"],
          ]}
        />
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-3">
          <Hud>v{preset.version}</Hud>
          <Button asChild variant="default">
            <Link
              aria-label={`Use this preset: ${preset.title}`}
              params={{ presetId: preset.id }}
              search={{ version: preset.version }}
              to="/presets/$presetId"
            >
              Use this preset
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
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
    <div className="relative isolate">
      <PageGlow />
      <SiteHeader category="Video">
        <OpenWeightsBadge />
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-330 flex-col gap-10 px-4 pt-12 pb-24 sm:px-8">
        <div className="flex max-w-2xl flex-col gap-4">
          <Hud>Motion presets</Hud>
          <h1 className="font-display text-4xl leading-tight font-bold tracking-display sm:text-5xl">
            Start from a ready-made shot
          </h1>
          <p className="text-base text-soft-foreground">
            Each preset is a motion, a look and a seed that rendered the example you see. Pick one,
            add your character, and generate. You can still change the look and the seed.
          </p>
        </div>
        <ul aria-label="Presets" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((view) => (
            <li key={view.preset.id}>
              <PresetCard view={view} />
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter tagline="Open Photon · MIT licensed · Made for #OpenSourceHiggsfield" />
    </div>
  );
}
