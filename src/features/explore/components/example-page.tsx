import { cn } from "cn";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  DownloadIcon,
  FileBracesIcon,
  ImageIcon,
  LockIcon,
  type LucideIcon,
  Share2Icon,
} from "lucide-react";

import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import { ExamplePreview } from "#/features/explore/components/example-preview";
import {
  AllTakesLink,
  TakeColumns,
  takeFigure,
  TakeFrame,
} from "#/features/explore/components/explore-frame";
import type { ExploreDetail } from "#/features/explore/contracts";
import { lookLabels } from "#/features/explore/look-labels";
import { Hud } from "#/shared/components/brand";
import { ClipStill } from "#/shared/components/clip-still";
import { LoopingVideo } from "#/shared/components/looping-video";
import { PageHeading } from "#/shared/components/page-heading";
import { SummaryPanel, SummaryRow } from "#/shared/components/summary-panel";
import { mediaUrl } from "#/shared/media";

const lockIcon = <LockIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />;

/** One entry of the full recipe; `code` for an identifier. */
function Entry({
  children,
  code = false,
  label,
}: {
  children: React.ReactNode;
  code?: boolean;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt>
        <Hud>{label}</Hud>
      </dt>
      <dd
        className={cn(
          "min-w-0 wrap-anywhere text-soft-foreground",
          code ? "font-mono text-xs" : "type-caption",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** A link that is only an icon, in the row under the remake action. */
function IconLink({
  download = false,
  href,
  icon: Icon,
  label,
}: {
  download?: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Button aria-label={label} asChild size="icon" title={label} variant="outline">
      <a download={download || undefined} href={href}>
        <Icon aria-hidden="true" strokeWidth={1.75} />
      </a>
    </Button>
  );
}

/** Where an input that is not public would be: said so, nothing of it shown. */
function PrivateInput({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-4 text-center type-caption text-muted-foreground">
      <span className="flex min-w-0 flex-col items-center gap-2">
        <LockIcon aria-hidden="true" className="size-6" />
        {children}
      </span>
    </div>
  );
}

/** Everything the panel leaves out, folded under it: the look in full, the seed, the pins. */
function FullRecipe({ example }: { example: ExploreDetail }) {
  const { recipe } = example;

  return (
    <Collapsible>
      <div className="flex flex-col">
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="ghost">
            <span>Full recipe</span>
            <ChevronDownIcon
              aria-hidden="true"
              className="transition-transform in-aria-expanded:rotate-180 motion-reduce:transition-none"
            />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <dl aria-label="Full recipe" className="flex flex-col gap-3 px-5 pt-2">
          <Entry label="Look">{example.look.text}</Entry>
          <Entry code label="Seed">
            {example.seed}
          </Entry>
          <Entry code label="Size">
            {recipe.width}×{recipe.height} · {recipe.fragmentLength} frames per window
          </Entry>
          <Entry code label="Workflow">
            {recipe.workflow.id} v{recipe.workflow.version} · {recipe.workflow.sha256}
          </Entry>
          <Entry label="Models">
            {recipe.models.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {recipe.models.map((model) => (
                  <li className="font-mono text-xs" key={model.file}>
                    {model.file} · {model.license}
                  </li>
                ))}
              </ul>
            ) : (
              "This render predates model pinning."
            )}
          </Entry>
          <Entry label="Rendered on">
            {recipe.target === "cloud" ? "Comfy Cloud" : "Self-hosted ComfyUI"}
          </Entry>
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A take's page: the source clip beside the take when that clip is public (a sample motion's; any
 * other is said to be private and not shown), and the recipe: the motion, the character as far as
 * it is public and the look, "Make this with my character", the public share page, the side by
 * side, the recipe JSON, and the rest of the recipe folded under them.
 */
export function ExamplePage({ example }: { example: ExploreDetail }) {
  const { character, remix, source } = example;

  const note = [
    !remix.motionKept &&
      "This take's motion clip is not public, so you pick a motion first; the look and seed are kept.",
    character && !character.image && "The image this take used is no longer this character's.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <TakeFrame>
      <AllTakesLink />
      <PageHeading title={example.title} />
      <TakeColumns
        aside={
          <>
            <SummaryPanel
              actions={
                <>
                  <Button asChild>
                    <a href={remix.href}>
                      <span>Make this with my character</span>
                      <ArrowRightIcon aria-hidden="true" />
                    </a>
                  </Button>
                  <div className="flex justify-center gap-1.5 pt-1">
                    <IconLink href={example.pageUrl} icon={Share2Icon} label="Share page" />
                    {example.compare && (
                      <IconLink
                        href={`${mediaUrl(example.compare)}?download=1`}
                        icon={DownloadIcon}
                        label="Download side by side"
                      />
                    )}
                    <IconLink
                      download
                      href={example.recipeUrl}
                      icon={FileBracesIcon}
                      label="Download the recipe"
                    />
                  </div>
                </>
              }
              label="The recipe"
              note={note}
            >
              <SummaryRow
                icon={lockIcon}
                label="Motion"
                media={source ? <ClipStill src={mediaUrl(source)} /> : undefined}
                value={
                  example.motion.sample ? example.motion.title : "A clip of their own (private)"
                }
              />
              <SummaryRow
                icon={lockIcon}
                label="Character"
                media={
                  character?.image ? (
                    <img
                      alt={`${character.title ?? "The character"}, an AI-generated image`}
                      className="absolute inset-0 size-full object-cover"
                      src={mediaUrl(character.image)}
                    />
                  ) : undefined
                }
                value={character?.title ?? "A private character"}
              />
              <SummaryRow
                icon={<ImageIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
                label="Look"
                value={lookLabels([example.look]).get(example.look.key)}
              />
            </SummaryPanel>
            <FullRecipe example={example} />
          </>
        }
      >
        <figure className={takeFigure}>
          <div className="relative aspect-9/16 overflow-hidden rounded-xl bg-screen shadow-hairline">
            {source ? (
              <LoopingVideo
                className="absolute inset-0 size-full rounded-none object-cover"
                label={`Source motion: ${example.motion.title}`}
                lazy
                src={mediaUrl(source)}
              />
            ) : (
              <PrivateInput>The source clip is not public, so it is not shown.</PrivateInput>
            )}
          </div>
          <figcaption>
            <Hud>Source</Hud>
          </figcaption>
        </figure>
        <figure className={takeFigure}>
          <ExamplePreview
            className="aspect-9/16 rounded-xl shadow-hairline"
            framed
            label={`AI-generated result: ${example.title}`}
            poster={example.poster}
            video={example.result}
          />
          <figcaption>
            <Hud>Take</Hud>
          </figcaption>
        </figure>
      </TakeColumns>
    </TakeFrame>
  );
}
