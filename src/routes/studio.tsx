import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Play } from "lucide-react";
import { useRef, useState } from "react";

import { JobProgress } from "#/components/job-progress";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { studioSearchSchema } from "#/lib/contracts";
import { createJob, getJob } from "#/lib/jobs.functions";

export const Route = createFileRoute("/studio")({
  validateSearch: (search) => studioSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({ job: search.job }),
  loader: ({ deps }) => (deps.job ? getJob({ data: { id: deps.job } }) : null),
  component: Studio,
});

type Submission = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string };

function Studio() {
  const { preset, take } = Route.useSearch();
  const row = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const attempt = useRef<{ id: string; signature: string } | null>(null);
  const [submission, setSubmission] = useState<Submission>({ kind: "idle" });

  const submit = async (form: FormData) => {
    setSubmission({ kind: "saving" });

    try {
      const prompt = form.get("prompt");

      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- FormData boundary; a zod parse here would surface a ZodError instead of this message.
      if (typeof prompt !== "string") {
        throw new Error("Write a prompt first.");
      }

      const signature = JSON.stringify({ prompt, preset, take });

      if (!attempt.current || attempt.current.signature !== signature) {
        attempt.current = { id: crypto.randomUUID(), signature };
      }

      const row = await createJob({
        data: { id: attempt.current.id, prompt, preset, take },
      });

      await navigate({ search: { preset, take, job: row.id } });

      if (row.status !== "unknown" && row.status !== "submitting") {
        attempt.current = null;
      }

      setSubmission({ kind: "idle" });
    } catch (error) {
      setSubmission({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save the job.",
      });
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <Link
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        to="/"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Back
      </Link>
      <header className="space-y-3">
        <p className="text-sm font-medium tracking-widest text-muted-foreground uppercase">
          Comfy / studio
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">Animate a character.</h1>
        <p className="text-muted-foreground">
          Wan Animate 2 transfers the sample video’s motion onto the reference character. Progress
          comes from Comfy, and the finished MP4 is saved here.
        </p>
      </header>
      <div className="flex gap-3 text-sm">
        <span className="rounded-full border bg-card px-3 py-1">
          Preset: <strong data-testid="preset">{preset}</strong>
        </span>
        <span className="rounded-full border bg-card px-3 py-1">
          Take: <strong data-testid="take">{take}</strong>
        </span>
      </div>
      <form action={submit} className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <label className="block text-sm font-medium" htmlFor="prompt">
          Describe the character and background
        </label>
        <Input
          defaultValue="Character Description: Cartoon character lost. Background description: The background is an empty white room."
          id="prompt"
          maxLength={500}
          name="prompt"
          placeholder="Character appearance and background"
          required
        />
        <Button
          disabled={
            submission.kind === "saving" ||
            (row !== null && !["complete", "failed"].includes(row.status))
          }
          type="submit"
        >
          <Play aria-hidden="true" />{" "}
          {submission.kind === "saving" ? "Submitting…" : "Render on Comfy"}
        </Button>
        {submission.kind === "error" && (
          <p className="text-sm text-destructive" role="alert">
            {submission.message}
          </p>
        )}
      </form>
      {row !== null && (
        <section
          aria-label="Saved job"
          className="space-y-5 rounded-xl border bg-card p-6 shadow-sm"
        >
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Saved render</h2>
            <p className="font-mono text-xs break-all text-muted-foreground" data-testid="job-id">
              {row.id}
            </p>
          </div>
          <JobProgress job={row} key={row.id} />
          <Link className="block text-sm underline" params={{ jobId: row.id }} to="/r/$jobId">
            Share this job
          </Link>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              View the returned row
            </summary>
            <pre
              className="mt-3 overflow-auto rounded-lg bg-muted p-4 text-xs"
              data-testid="saved-row"
            >
              {JSON.stringify(row, null, 2)}
            </pre>
          </details>
        </section>
      )}
    </main>
  );
}
