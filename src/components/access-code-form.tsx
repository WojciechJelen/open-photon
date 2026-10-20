import { useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { z } from "zod";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { callApi } from "#/lib/requests";

/**
 * The inline "Enter access code" step of an action that needs one (an upload, a generation), or
 * of a page that shows the visitor's own uploads: the code goes to `POST /api/session`, which
 * sets the session cookie; then the page's data is loaded again (it says whether the visitor has
 * a session, and shows those uploads) and `onSignedIn`, if given, carries on with the action, on
 * the same page with every choice as it was.
 */
export function AccessCodeForm({ onSignedIn }: { onSignedIn?: () => void }) {
  const router = useRouter();
  const id = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);

    const result = await callApi(z.null(), "/api/session", {
      body: JSON.stringify({ code: code.trim() }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    setPending(false);

    if ("refusal" in result) {
      setError(result.refusal.message);

      return;
    }

    void router.invalidate();
    onSignedIn?.();
  }

  return (
    <form
      aria-label="Access code"
      className="flex flex-col gap-2 rounded-md border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Label htmlFor={id}>Access code</Label>
      <p className="text-sm text-muted-foreground">
        Uploads and new generations need an access code. Ask the owner for one.
      </p>
      <Input
        autoComplete="current-password"
        id={id}
        onChange={(event) => setCode(event.target.value)}
        type="password"
        value={code}
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button disabled={pending || code.trim() === ""} type="submit">
          {pending ? "Checking…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
