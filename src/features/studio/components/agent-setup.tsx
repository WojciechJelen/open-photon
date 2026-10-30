import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";

type Instructions =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; text: string; copy: "idle" | "copied" | "manual" };

export function AgentSetup() {
  const [instructions, setInstructions] = useState<Instructions>({ kind: "loading" });
  const manualId = useId();

  useEffect(() => {
    const controller = new AbortController();

    // Load before the click: clipboard writes need the user's live click gesture in some browsers.
    fetch("/setup.md", { signal: controller.signal })
      .then((response) => {
        if (!response.ok || !response.headers.get("Content-Type")?.startsWith("text/plain")) {
          throw new Error("Setup instructions are unavailable");
        }

        return response.text();
      })
      .then((text) => setInstructions({ copy: "idle", kind: "ready", text }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setInstructions({ kind: "unavailable" });
        }
      });

    return () => controller.abort();
  }, []);

  async function copyInstructions() {
    if (instructions.kind !== "ready") {
      return;
    }

    try {
      await navigator.clipboard.writeText(instructions.text);
      setInstructions({ ...instructions, copy: "copied" });
    } catch {
      setInstructions({ ...instructions, copy: "manual" });
    }
  }

  const copied = instructions.kind === "ready" && instructions.copy === "copied";
  const manual = instructions.kind === "ready" && instructions.copy === "manual";

  return (
    <section
      aria-labelledby="agent-setup-heading"
      className="flex scroll-mt-8 flex-col gap-5 border-t pt-8"
      id="self-host"
    >
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
        <div className="flex max-w-lg flex-col gap-2">
          <h3 className="font-display text-xl font-semibold" id="agent-setup-heading">
            Run Open Photon on your own account.
          </h3>
          <p className="text-sm text-soft-foreground">
            Let your agent walk you through hosting, credentials and your first render. Docker for
            the app, Runpod for the complete GPU setup.
          </p>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={instructions.kind !== "ready"}
              onClick={copyInstructions}
              size="sm"
              type="button"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied setup instructions" : "Copy agent setup instructions"}
            </Button>
            <Button asChild size="sm" variant="link">
              <a href="/setup.md">Read setup.md</a>
            </Button>
          </div>
          <p className="text-sm text-soft-foreground">
            Paste into a coding agent with terminal access.
          </p>
        </div>
      </div>
      <p aria-live="polite" className="text-sm text-soft-foreground empty:hidden" role="status">
        {instructions.kind === "loading"
          ? "Loading setup instructions…"
          : instructions.kind === "unavailable"
            ? "Instructions could not load. Open Read setup.md to try again."
            : copied
              ? "Setup instructions copied. Paste them into your coding agent."
              : manual
                ? "Copying is not allowed here. Select the instructions below and copy them by hand."
                : ""}
      </p>
      {manual && (
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={manualId}>Setup instructions</Label>
          <div className="max-h-64 overflow-y-auto">
            <Textarea
              id={manualId}
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              rows={10}
              value={instructions.text}
            />
          </div>
        </div>
      )}
    </section>
  );
}
