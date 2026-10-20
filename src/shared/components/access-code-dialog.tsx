import { Link, useRouter } from "@tanstack/react-router";
import { KeyRoundIcon } from "lucide-react";
import { useId, useState } from "react";
import { z } from "zod";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { StatusDot } from "#/shared/components/brand";
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
 * and the header's "Access code" chip opens it on its own (`useAccessCode` holds the actions and
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
      <DialogContent>
        <span
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-full border border-brand/35 bg-brand/12 text-brand-foreground"
        >
          <KeyRoundIcon className="size-5.5" />
        </span>
        <DialogHeader>
          <DialogTitle>Enter your access code</DialogTitle>
          <DialogDescription>
            Uploads and new renders spend the owner's Comfy credits, so they need a code. Ask the
            owner for one.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
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
            <p className="text-sm text-muted-foreground" id={`${id}-hint`}>
              {carriesOn[action]} Access lasts 12 hours.
            </p>
            {error && (
              <p className="text-sm text-destructive-foreground" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
              Not now
            </Button>
            <Button disabled={pending || code.trim() === ""} size="lg" type="submit">
              {pending ? "Checking…" : unlockLabels[action]}
            </Button>
          </DialogFooter>
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

/**
 * The access status a page shows up front, in its header: "Code active" with a session, else
 * an "Access code" button that opens the dialog (`onOpen`). `compact` is the icon-only button of
 * the mobile header.
 */
export function AccessStatus({
  compact = false,
  onOpen,
  signedIn,
}: {
  compact?: boolean;
  onOpen: () => void;
  signedIn: boolean;
}) {
  if (signedIn) {
    return (
      <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-input px-3.5 text-sm font-medium text-soft-foreground">
        <StatusDot tone="ok" />
        <span className={compact ? "sr-only" : undefined}>Code active</span>
      </span>
    );
  }

  return (
    <Button onClick={onOpen} size={compact ? "icon" : "sm"} variant="chip">
      <KeyRoundIcon />
      <span className={compact ? "sr-only" : undefined}>Access code</span>
    </Button>
  );
}
