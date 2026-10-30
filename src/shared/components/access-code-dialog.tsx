import { Link, useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { z } from "zod";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { StableText } from "#/shared/components/stable-text";
import { callApi } from "#/shared/requests";

/** What waits for the code: the dialog names it, and carries it on once the code works. */
export type HeldAction = "generate" | "rerun" | "retry" | "unlock" | "upload";

const unlockLabels: Record<HeldAction, string> = {
  generate: "Unlock and generate",
  rerun: "Unlock and re-run",
  retry: "Unlock and retry",
  unlock: "Unlock",
  upload: "Unlock and upload",
};

const carriesOn: Record<HeldAction, string> = {
  generate: "Your choices are kept. Generate carries on as soon as the code works.",
  rerun: "The re-run carries on as soon as the code works.",
  retry: "The retry carries on as soon as the code works.",
  unlock: "Your choices are kept.",
  upload: "Your file waits. It uploads as soon as the code works.",
};

/**
 * The access-code dialog: an action that needs a code (an upload, a new render, a retry) opens it,
 * and the header's "Enter access code" opens it on its own (`useAccessCode` holds the actions and
 * drives it). The code goes to `POST /api/session`, which sets the session cookie; then the
 * page's data is loaded again (it says whether the visitor has a session, and shows their
 * uploads) and `onSignedIn` carries on with what was held, on the same page with every choice as
 * it was. `sampleTakeId` names a pre-rendered sample take,
 * offered as the free way in; without one, nothing claims anything is free.
 */
export function AccessCodeDialog({
  action,
  onOpenChange,
  onSignedIn,
  open,
  sampleTakeId,
}: {
  action: HeldAction;
  onOpenChange: (open: boolean) => void;
  onSignedIn: () => void;
  open: boolean;
  sampleTakeId?: string | null;
}) {
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

    setCode("");
    void router.invalidate();
    // Before closing: closing without a sign-in drops what was held (`useAccessCode`).
    onSignedIn();
    onOpenChange(false);
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
        }

        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Enter your access code</DialogTitle>
          <DialogDescription>Upload your own clips and start rendering.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={id}>Access code</Label>
            <Input
              aria-describedby={`${id}-hint`}
              aria-invalid={error !== null}
              autoComplete="one-time-code"
              id={id}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Your code"
              type="password"
              value={code}
            />
            <p className="type-hint text-muted-foreground" id={`${id}-hint`}>
              {carriesOn[action]} Ask the owner for a code. Access lasts 12 hours.
            </p>
            {/* Its line is kept empty, so a refusal moves nothing under it. */}
            <div className="min-h-5">
              {error && (
                <p className="type-caption text-destructive-foreground" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Button disabled={pending || code.trim() === ""} type="submit">
              <StableText
                current={pending ? "Checking…" : unlockLabels[action]}
                labels={[unlockLabels[action], "Checking…"]}
              />
            </Button>
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
              Not now
            </Button>
          </div>
        </form>
        {sampleTakeId && (
          <p className="border-t pt-4 text-center text-sm text-muted-foreground">
            No code?{" "}
            <Link
              className="text-soft-foreground underline decoration-edge-strong underline-offset-3 hover:text-foreground"
              params={{ generationId: sampleTakeId }}
              to="/g/$generationId"
            >
              Try a sample pair
            </Link>
            : it is already rendered and free to watch.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
