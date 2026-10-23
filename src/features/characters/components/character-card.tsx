import { cn } from "cn";
import { PencilIcon, PlayIcon, StarIcon } from "lucide-react";
import type { Ref } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { CharacterImage } from "#/features/characters/components/character-image";
import type { CharacterSummary } from "#/features/characters/contracts";
import { characterName, modelName, originLabel } from "#/features/characters/library";
import { Viewfinder } from "#/shared/components/brand";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** How a character came to be: its origin and date, and for a generated one what made it. */
function Provenance({ character }: { character: CharacterSummary }) {
  const created = dateFormat.format(new Date(character.created_at));

  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <span>
        {character.is_sample
          ? "Sample character"
          : character.origin === "upload"
            ? `Uploaded ${created}`
            : `AI image, generated ${created}`}
      </span>
      {character.prompt && (
        <p className="line-clamp-2 text-soft-foreground" title={character.prompt}>
          “{character.prompt}”
        </p>
      )}
      {character.provenance && (
        <details className="group">
          <summary className="cursor-pointer rounded-sm text-soft-foreground underline decoration-edge-strong underline-offset-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Made with
          </summary>
          <dl className="mt-1.5 flex flex-col gap-1 break-all">
            <dt className="sr-only">Workflow</dt>
            <dd>
              {character.provenance.workflow.id} v{character.provenance.workflow.version}
            </dd>
            <dt className="sr-only">Models</dt>
            {character.provenance.models.map((model) => (
              <dd key={model.sha256} title={`${model.file} · ${model.license}`}>
                {modelName(model.file)}
              </dd>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

/**
 * One character of the library: its image (a placeholder when it does not load), origin badge,
 * name (the title, or what it is), provenance, a favorite toggle, "Animate" (`animateHref`, to the
 * Motion Transfer wizard with it picked) and Rename (not for a sample, whose title is fixed).
 * `selected` rings it, as the character the page was opened on.
 */
export function CharacterCard({
  animateHref,
  character,
  favoritePending,
  onFavorite,
  onRename,
  ref,
  selected,
}: {
  animateHref: string;
  character: CharacterSummary;
  favoritePending: boolean;
  onFavorite: () => void;
  onRename: () => void;
  ref?: Ref<HTMLElement>;
  selected: boolean;
}) {
  const name = characterName(character);
  const favorite = character.favorite_at !== null;

  return (
    <article
      aria-current={selected ? "true" : undefined}
      aria-label={name}
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border bg-card focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring",
        selected && "border-transparent shadow-picked",
      )}
      data-character-id={character.id}
      ref={ref}
      tabIndex={-1}
    >
      <div className="relative aspect-3/4 w-full overflow-hidden bg-screen">
        <CharacterImage character={character} />
        {selected && <Viewfinder className="inset-2.5" tone="brand" />}
        <span className="absolute top-3 left-3">
          <Badge variant="solid">{originLabel(character)}</Badge>
        </span>
        <span className="absolute top-1.5 right-1.5 rounded-full bg-background/65 backdrop-blur-md">
          <Button
            aria-label={favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
            aria-pressed={favorite}
            // Not `disabled`: the button keeps the keyboard focus while the change is saved.
            aria-disabled={favoritePending}
            onClick={() => !favoritePending && onFavorite()}
            size="icon"
            variant="ghost"
          >
            <StarIcon aria-hidden="true" className={cn(favorite && "fill-warning text-warning")} />
          </Button>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <h3 className="truncate text-base leading-tight font-semibold" title={name}>
          {name}
        </h3>
        <Provenance character={character} />
        <div className="mt-auto flex flex-wrap items-center gap-1">
          <Button asChild size="sm">
            <a aria-label={`Animate ${name}`} href={animateHref}>
              <PlayIcon aria-hidden="true" />
              Animate
            </a>
          </Button>
          {!character.is_sample && (
            <Button aria-label={`Rename ${name}`} onClick={onRename} size="sm" variant="ghost">
              <PencilIcon aria-hidden="true" />
              Rename
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
