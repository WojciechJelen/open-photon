import { ChevronDownIcon, FileCodeIcon } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import type { Recipe } from "#/features/genjutsu/server/recipe";

/** One row of the recipe: a label and its value, monospaced when it is an identifier. */
function Entry({ code, label, value }: { code?: boolean; label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={code ? "font-mono text-xs break-all sm:col-span-2" : "break-words sm:col-span-2"}
      >
        {value}
      </dd>
    </div>
  );
}

/** A reshoot preset's id in words: `three-quarter` reads "Three-quarter". */
export function angleName(angle: string | undefined) {
  return angle ? `${angle.charAt(0).toUpperCase()}${angle.slice(1)}` : "As filmed";
}

/**
 * The stored recipe of a generation, folded into one line ("Recipe · workflow · seed") until
 * opened: the workflow file and its SHA-256, the models, every parameter (with the reshoot
 * angle), the SHA-256 of both input files and the target. Everything that decides the render, and
 * so its `recipe_hash`. `children` are its actions (Re-run, the JSON), shown inside.
 */
export function RecipePanel({ children, recipe }: { children?: React.ReactNode; recipe: Recipe }) {
  return (
    <div className="rounded-2xl border bg-linear-to-b from-foreground/4 to-foreground/1">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button
            className="group flex min-h-16 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-5 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            type="button"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <FileCodeIcon aria-hidden="true" className="size-4 text-brand" />
                Recipe
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {recipe.workflow.id} v{recipe.workflow.version} · seed {recipe.params.seed}
              </span>
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform group-aria-expanded:rotate-180"
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-4 px-5 pb-5">
            <dl aria-label="Recipe" className="flex flex-col gap-2.5 text-sm">
              <Entry
                code
                label="Workflow"
                value={`${recipe.workflow.id} v${recipe.workflow.version}`}
              />
              <Entry code label="Workflow SHA-256" value={recipe.workflow.sha256} />
              <div className="grid gap-1 sm:grid-cols-3 sm:gap-4">
                <dt className="text-muted-foreground">Models</dt>
                <dd className="sm:col-span-2">
                  {recipe.models.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {recipe.models.map((model) => (
                        <li className="font-mono text-xs break-all" key={model.file}>
                          {model.file} · {model.license} · {model.sha256}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "This render predates model pinning. Its recipe has no recorded model hashes or licenses."
                  )}
                </dd>
              </div>
              <Entry label="Reshoot angle" value={angleName(recipe.angle)} />
              <Entry
                code
                label="Size"
                value={`${recipe.params.width}×${recipe.params.height} · ${recipe.params.fragment_length} frames per window`}
              />
              <Entry label="Look" value={recipe.params.prompt} />
              <Entry code label="Seed" value={String(recipe.params.seed)} />
              <Entry code label="Motion clip SHA-256" value={recipe.inputs.driving_video_sha256} />
              <Entry
                code
                label="Character image SHA-256"
                value={recipe.inputs.reference_image_sha256}
              />
              <Entry
                label="Rendered on"
                value={recipe.target === "cloud" ? "Comfy Cloud" : "Self-hosted ComfyUI"}
              />
            </dl>
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
