import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { characterSchema } from "#/features/genjutsu/contracts";
import { AccessCodeForm } from "#/shared/components/access-code-form";
import { callApi } from "#/shared/requests";
import { useRequestSignal } from "#/shared/use-request-signal";

/**
 * Upload a photo of a person as the character. The consent checkbox gates the button; a refusal
 * (`consent_required`, `not_image`) shows inline until another character is chosen. Without an
 * access session (`signedIn`, or a 401 when it has expired) the code comes first, inline, and the
 * photo is uploaded right after it.
 */
export function CharacterUpload({
  onReady,
  selectedId,
  signedIn,
}: {
  onReady: (characterId: string) => void;
  selectedId: string | undefined;
  signedIn: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  // With the character chosen when it came: choosing another one clears it.
  const [refusal, setRefusal] = useState<{ message: string; selectedId: string | undefined }>();
  const error = refusal && refusal.selectedId === selectedId ? refusal.message : null;
  const nextSignal = useRequestSignal();

  async function submit(withSession: boolean) {
    if (!file || !consent) {
      return;
    }

    if (!withSession) {
      setNeedsCode(true);

      return;
    }

    const signal = nextSignal();
    const form = new FormData();

    form.append("consent", "true");
    form.append("image", file);
    setPending(true);
    setRefusal(undefined);

    const result = await callApi(characterSchema, "/api/characters", {
      body: form,
      method: "POST",
      signal,
    });

    // The page moved on (unmounted): the upload was cancelled, and nothing is selected.
    if (signal.aborted) {
      return;
    }

    setPending(false);

    if ("refusal" in result) {
      setNeedsCode(result.refusal.reason === "access_required");
      setRefusal(
        result.refusal.reason === "access_required"
          ? undefined
          : { message: result.refusal.message, selectedId },
      );
    } else {
      onReady(result.data.id);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-3 rounded-md border border-dashed p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(signedIn);
        }}
      >
        <Label htmlFor="character-file">Or upload a photo of a person</Label>
        <Input
          accept="image/png,image/jpeg,image/webp"
          id="character-file"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setRefusal(undefined);
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
      {needsCode && (
        <AccessCodeForm
          onSignedIn={() => {
            setNeedsCode(false);
            void submit(true);
          }}
        />
      )}
    </div>
  );
}
