import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import type { Recipe } from "#/server/recipe";

/** One row of the recipe: a label and its value, monospaced when it is an identifier. */
function Entry({ code, label, value }: { code?: boolean; label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all sm:col-span-2">{code ? <code>{value}</code> : value}</dd>
    </div>
  );
}

/**
 * The stored recipe of a generation, collapsed until opened: the workflow file and its SHA-256,
 * the models, every parameter (with the reshoot angle), the SHA-256 of both input files and the
 * target. Everything that decides the render, and so its `recipe_hash`.
 */
export function RecipePanel({ recipe }: { recipe: Recipe }) {
  return (
    <Collapsible>
      <div>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline">
            Recipe
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <dl aria-label="Recipe" className="mt-3 flex flex-col gap-2 text-sm">
          <Entry
            code
            label="Workflow"
            value={`${recipe.workflow.id} v${recipe.workflow.version}`}
          />
          <Entry code label="Workflow SHA-256" value={recipe.workflow.sha256} />
          <div className="grid gap-1 sm:grid-cols-3">
            <dt className="text-muted-foreground">Models</dt>
            <dd className="sm:col-span-2">
              {recipe.models.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {recipe.models.map((model) => (
                    <li className="break-all" key={model.file}>
                      <code>{model.file}</code> · {model.license} · <code>{model.sha256}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                "None recorded. Recipes list their model files, with hashes and licenses, once the repository pins them in models.lock; it does not yet."
              )}
            </dd>
          </div>
          <Entry label="Reshoot angle" value={recipe.angle ?? "As filmed"} />
          {Object.entries(recipe.params).map(([name, value]) => (
            <Entry code={name !== "prompt"} key={name} label={name} value={String(value)} />
          ))}
          <Entry code label="Motion clip SHA-256" value={recipe.inputs.driving_video_sha256} />
          <Entry
            code
            label="Character image SHA-256"
            value={recipe.inputs.reference_image_sha256}
          />
          <Entry
            label="Target"
            value={recipe.target === "cloud" ? "Comfy Cloud" : "Self-hosted ComfyUI"}
          />
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
