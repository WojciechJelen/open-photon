import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import { Textarea } from "#/components/ui/textarea";
import { type AngleChoice, generateInputSchema } from "#/lib/contracts";
import { generate } from "#/lib/generate.functions";
import { useRequestSignal } from "#/lib/use-request-signal";

type Field = "angle" | "character_id" | "motion_asset_id" | "prompt" | "seed";

const messages: Record<Field, string> = {
  angle: "Choose one of the angles.",
  character_id: "Pick a character first.",
  motion_asset_id: "Pick a motion first.",
  prompt: "Keep the description under 500 characters.",
  seed: `The seed is a whole number from 0 to ${Number.MAX_SAFE_INTEGER}.`,
};

const fields = new Set<string>(Object.keys(messages));

function isField(key: PropertyKey | undefined): key is Field {
  return fields.has(String(key));
}

/**
 * The options and the Generate button. The form is checked against `generateInputSchema` in the
 * browser first: an invalid form shows why and never calls the server. A started (or reused)
 * generation opens at `/g/:id`.
 */
export function GenerateForm({
  angles,
  characterId,
  motionAssetId,
  placeholderAngles,
}: {
  angles: AngleChoice[];
  characterId: string | undefined;
  motionAssetId: string | undefined;
  placeholderAngles: boolean;
}) {
  const navigate = useNavigate();
  const [angle, setAngle] = useState("none");
  const [prompt, setPrompt] = useState("");
  const [seed, setSeed] = useState("");
  const [errors, setErrors] = useState<Field[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nextSignal = useRequestSignal();

  async function submit() {
    const parsed = generateInputSchema.safeParse({
      angle: angle === "none" ? undefined : angle,
      character_id: characterId,
      motion_asset_id: motionAssetId,
      prompt: prompt.trim() || undefined,
      // Anything but digits becomes NaN, which the schema refuses.
      seed: seed.trim() === "" ? undefined : /^\d+$/.test(seed.trim()) ? Number(seed) : Number.NaN,
    });

    setFailure(null);

    if (!parsed.success) {
      setErrors([
        ...new Set(
          parsed.error.issues.flatMap(({ path: [field] }) => (isField(field) ? [field] : [])),
        ),
      ]);

      return;
    }

    setErrors([]);
    setPending(true);

    // Not passed to `generate`: a submit that reached the server finishes there. Leaving the page
    // only drops the navigation to its result.
    const signal = nextSignal();

    try {
      const { id } = await generate({ data: parsed.data });

      if (!signal.aborted) {
        await navigate({ params: { generationId: id }, to: "/g/$generationId" });
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The generation could not start.");
      setPending(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Reshoot angle</legend>
        <RadioGroup onValueChange={setAngle} value={angle}>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="angle-none" value="none" />
            <Label htmlFor="angle-none">As filmed</Label>
          </div>
          {angles.map((choice) => (
            <div className="flex items-center gap-2" key={choice.id}>
              <RadioGroupItem id={`angle-${choice.id}`} value={choice.id} />
              <Label htmlFor={`angle-${choice.id}`}>{choice.label}</Label>
            </div>
          ))}
        </RadioGroup>
        {placeholderAngles && (
          <p className="text-sm text-muted-foreground">
            The angle phrasings are placeholders until the angle benchmark has picked them.
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="generate-prompt">Appearance and background (optional)</Label>
        <Textarea
          aria-invalid={errors.includes("prompt")}
          id="generate-prompt"
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="For example: a red raincoat, on a beach at sunset"
          value={prompt}
        />
      </div>

      <Collapsible>
        <div>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline">
              Advanced
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="mt-2 flex flex-col gap-2">
            <Label htmlFor="generate-seed">Seed</Label>
            <Input
              aria-invalid={errors.includes("seed")}
              id="generate-seed"
              inputMode="numeric"
              onChange={(event) => setSeed(event.target.value)}
              placeholder="Random"
              value={seed}
            />
            <p className="text-sm text-muted-foreground">
              The same seed with the same choices gives the same result.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {errors.length > 0 && (
        <ul aria-label="Problems with the form" className="text-sm text-destructive" role="alert">
          {errors.map((field) => (
            <li key={field}>{messages[field]}</li>
          ))}
        </ul>
      )}
      {failure && (
        <p className="text-sm text-destructive" role="alert">
          {failure}
        </p>
      )}
      <div>
        <Button disabled={pending} type="submit">
          {pending ? "Starting…" : "Generate"}
        </Button>
      </div>
    </form>
  );
}
