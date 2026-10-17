import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Play } from "lucide-react";
import { useState } from "react";
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

type Submission =
	| { kind: "idle" }
	| { kind: "saving" }
	| { kind: "error"; message: string };

function Studio() {
	const { preset, take } = Route.useSearch();
	const row = Route.useLoaderData();
	const navigate = Route.useNavigate();
	const [submission, setSubmission] = useState<Submission>({ kind: "idle" });

	const submit = async (form: FormData) => {
		setSubmission({ kind: "saving" });
		try {
			const prompt = form.get("prompt");
			if (typeof prompt !== "string") throw new Error("Write a prompt first.");
			const row = await createJob({ data: { prompt, preset, take } });
			await navigate({ search: { preset, take, job: row.id } });
			setSubmission({ kind: "idle" });
		} catch (error) {
			setSubmission({
				kind: "error",
				message:
					error instanceof Error ? error.message : "Could not save the job.",
			});
		}
	};

	return (
		<main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
			<Link
				to="/"
				className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="size-4" aria-hidden="true" /> Back
			</Link>
			<header className="space-y-3">
				<p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
					Comfy / studio
				</p>
				<h1 className="text-4xl font-semibold tracking-tight">Try a render.</h1>
				<p className="text-muted-foreground">
					Save a real job, then watch a simulated render stream to your browser.
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
			<form
				action={submit}
				className="space-y-4 rounded-xl border bg-card p-6 shadow-sm"
			>
				<label htmlFor="prompt" className="block text-sm font-medium">
					Describe your shot
				</label>
				<Input
					id="prompt"
					name="prompt"
					placeholder="A slow orbit around a ceramic vase"
					defaultValue="A slow orbit around a ceramic vase"
					required
					maxLength={500}
				/>
				<Button type="submit" disabled={submission.kind === "saving"}>
					<Play aria-hidden="true" />{" "}
					{submission.kind === "saving" ? "Saving…" : "Create job"}
				</Button>
				{submission.kind === "error" && (
					<p role="alert" className="text-sm text-destructive">
						{submission.message}
					</p>
				)}
			</form>
			{row !== null && (
				<section
					className="space-y-5 rounded-xl border bg-card p-6 shadow-sm"
					aria-label="Saved job"
				>
					<div className="space-y-1">
						<h2 className="text-lg font-semibold">Job saved to SQLite</h2>
						<p
							className="break-all font-mono text-xs text-muted-foreground"
							data-testid="job-id"
						>
							{row.id}
						</p>
					</div>
					<JobProgress key={row.id} job={row} />
					<Link
						to="/r/$jobId"
						params={{ jobId: row.id }}
						className="block text-sm underline"
					>
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
