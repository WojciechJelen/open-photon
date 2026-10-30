import { ChevronDownIcon, FileBracesIcon } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import type { Recipe } from "#/features/motionTransfer/server/recipe";

/**
 * One row of the recipe: a label and its value, monospaced when it is an identifier. It goes by the
 * panel's width, not the screen's: the panel is narrow in the result's aside on any screen.
 */
function Entry({ code, label, value }: { code?: boolean; label: string; value: string }) {
  return (
    <div className="grid gap-1 @lg:grid-cols-3 @lg:gap-4">
      <dt className="wrap-anywhere text-muted-foreground">{label}</dt>
      <dd
        className={
          code
            ? "font-mono text-xs wrap-anywhere @lg:col-span-2"
            : "wrap-anywhere whitespace-pre-wrap @lg:col-span-2"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The stored recipe of a generation, folded into one line ("Recipe · workflow · seed") until
 * opened: the workflow file and its SHA-256, the models, every parameter, the SHA-256 of both
 * input files and the target. Everything that decides the render, and so its `recipe_hash`; a
 * take made with a retired reshoot-angle preset also hashes its `angle`, which only the JSON
 * shows (its phrasing is in the prompt shown here). `children` add to it, inside (the share
 * page's model files).
 */
export function RecipePanel({ children, recipe }: { children?: React.ReactNode; recipe: Recipe }) {
  return (
    <div className="rounded-2xl border bg-card/72">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button
            className="group flex min-h-16 w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-5 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            type="button"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <FileBracesIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-brand"
                  strokeWidth={1.75}
                />
                <span className="min-w-0 truncate">Recipe</span>
              </span>
              <span
                className="truncate font-mono text-xs text-muted-foreground"
                title={`${recipe.workflow.id} v${recipe.workflow.version} · seed ${recipe.params.seed}`}
              >
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
            <dl aria-label="Recipe" className="@container flex flex-col gap-2.5 type-caption">
              <Entry
                code
                label="Workflow"
                value={`${recipe.workflow.id} v${recipe.workflow.version}`}
              />
              <Entry code label="Workflow SHA-256" value={recipe.workflow.sha256} />
              <div className="grid gap-1 @lg:grid-cols-3 @lg:gap-4">
                <dt className="wrap-anywhere text-muted-foreground">Models</dt>
                <dd className="@lg:col-span-2">
                  {recipe.models.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {recipe.models.map((model) => (
                        <li
                          className="flex flex-col font-mono text-xs wrap-anywhere"
                          key={model.file}
                        >
                          <span>
                            {model.file} · {model.license}
                          </span>
                          <span className="text-muted-foreground">{model.sha256}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "This render predates model pinning. Its recipe has no recorded model hashes or licenses."
                  )}
                </dd>
              </div>
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
