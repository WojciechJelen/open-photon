import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { AccessCodeForm } from "#/components/access-code-form";
import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import { Textarea } from "#/components/ui/textarea";
import { type AngleChoice, type GenerateInput, generateInputSchema } from "#/lib/contracts";
import { callApi, type Refusal } from "#/lib/requests";
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
 * generation opens at `/g/:id`. A refusal shows under the button (a full queue or too many
 * generations say when to try again); one that needs an access code asks for it inline, then
 * sends the same choices again. A blank description is `defaultPrompt` (its placeholder), a
 * blank seed the server's fixed default.
 */
export function GenerateForm({
  angles,
  characterId,
  defaultPrompt,
  motionAssetId,
  placeholderAngles,
}: {
  angles: AngleChoice[];
  characterId: string | undefined;
  defaultPrompt: string;
  motionAssetId: string | undefined;
  placeholderAngles: boolean;
}) {
  const navigate = useNavigate();
  const [angle, setAngle] = useState("none");
  const [prompt, setPrompt] = useState("");
  const [seed, setSeed] = useState("");
  const [errors, setErrors] = useState<Field[]>([]);
  const [failure, setFailure] = useState<Refusal | null>(null);
  const [pending, setPending] = useState(false);
  // A generation that waits for the access code.
  const [held, setHeld] = useState<GenerateInput | null>(null);
  const nextSignal = useRequestSignal();

  function submit() {
    const parsed = generateInputSchema.safeParse({
      angle: angle === "none" ? undefined : angle,
      character_id: characterId,
      motion_asset_id: motionAssetId,
      prompt: prompt.trim() || undefined,
      // Anything but digits becomes NaN, which the schema refuses.
      seed: seed.trim() === "" ? undefined : /^\d+$/.test(seed.trim()) ? Number(seed) : Number.NaN,
    });

    setFailure(null);
    setHeld(null);

    if (!parsed.success) {
      setErrors([
        ...new Set(
          parsed.error.issues.flatMap(({ path: [field] }) => (isField(field) ? [field] : [])),
        ),
      ]);

      return;
    }

    setErrors([]);
    void send(parsed.data);
  }

  async function send(input: GenerateInput) {
    setPending(true);

    // Not passed to the request: a submit that reached the server finishes there. Leaving the
    // page only drops the navigation to its result.
    const signal = nextSignal();

    const answer = await callApi(z.object({ id: z.uuid() }), "/api/generate", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (signal.aborted) {
      return;
    }

    if ("refusal" in answer) {
      if (answer.refusal.reason === "access_required") {
        setHeld(input);
      } else {
        setFailure(answer.refusal);
      }

      setPending(false);
    } else {
      await navigate({ params: { generationId: answer.data.id }, to: "/g/$generationId" });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
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
            placeholder={defaultPrompt}
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
                placeholder="Default"
                value={seed}
              />
              <p className="text-sm text-muted-foreground">
                The same seed with the same choices gives the same result. Left blank, the seed is a
                fixed default; “Retry with a new seed” picks a random one.
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
          <p
            aria-label="Not started"
            className="text-sm text-destructive"
            data-reason={failure.reason}
            role="alert"
          >
            {failure.message}
          </p>
        )}
        <div>
          <Button disabled={pending} type="submit">
            {pending ? "Starting…" : "Generate"}
          </Button>
        </div>
      </form>
      {held && (
        <AccessCodeForm
          onSignedIn={() => {
            setHeld(null);
            void send(held);
          }}
        />
      )}
    </div>
  );
}
