import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { characterSchema } from "#/lib/contracts";
import { callApi } from "#/lib/requests";

/**
 * Upload a photo of a person as the character. The consent checkbox gates the button; a refusal
 * (`consent_required`, `not_image`) shows inline.
 */
export function CharacterUpload({ onReady }: { onReady: (characterId: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file || !consent) {
      return;
    }

    const form = new FormData();

    form.append("consent", "true");
    form.append("image", file);
    setPending(true);
    setError(null);

    const result = await callApi(characterSchema, "/api/characters", {
      body: form,
      method: "POST",
    });

    setPending(false);

    if ("refusal" in result) {
      setError(result.refusal.message);
    } else {
      onReady(result.data.id);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-dashed p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Label htmlFor="character-file">Or upload a photo of a person</Label>
      <Input
        accept="image/png,image/jpeg,image/webp"
        id="character-file"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setError(null);
        }}
        type="file"
      />
      <div className="flex items-start gap-2">
        <Checkbox
          checked={consent}
          id="character-consent"
          onCheckedChange={(checked) => setConsent(checked === true)}
        />
        <Label htmlFor="character-consent">
          I may use this person's likeness: it is me, or they agreed to it.
        </Label>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button disabled={!file || !consent || pending} type="submit">
          {pending ? "Uploading…" : "Use this photo"}
        </Button>
      </div>
    </form>
  );
}
