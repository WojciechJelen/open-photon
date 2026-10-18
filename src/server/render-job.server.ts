import { setTimeout as delay } from "node:timers/promises";
import { Comfy, ComfyError, type Job, type Progress } from "@comfyorg/sdk";
import type { JobRow, NewJob } from "../lib/contracts.ts";
import { findJob, insertJob, saveWorkflow, updateJob } from "./db.server.ts";
import { saveVideoOutput } from "./video-output.server.ts";
import {
	prepareWanWorkflow,
	workflowGraphSchema,
} from "./wan-workflow.server.ts";

function client() {
	return new Comfy({ timeoutMs: 30000, clientInfo: "comfy-start-spike" });
}
const downloads = new Map<string, Promise<JobRow>>();

export async function submitJob(input: NewJob) {
	const { job, created } = insertJob(input);
	if (!created) return job;
	let sending = false;
	try {
		const comfy = client();
		const workflow = await prepareWanWorkflow(comfy, input);
		saveWorkflow(job.id, workflowGraphSchema.parse(workflow.json));
		sending = true;
		const accepted = await comfy.submit(workflow, { idempotencyKey: job.id });
		return updateJob(job.id, (current) => ({
			...current,
			status: "queued",
			providerJobId: accepted.id,
			completedAt: null,
			percent: null,
			message: "Queued on Comfy",
		}));
	} catch (error) {
		const rejected =
			error instanceof ComfyError &&
			error.httpStatus !== undefined &&
			error.httpStatus >= 400 &&
			error.httpStatus < 500 &&
			error.code !== "idempotency_key_reuse";
		const code =
			error instanceof ComfyError
				? (error.code ?? error.name)
				: "submission_error";
		console.error(
			JSON.stringify({
				event: "comfy.submission-error",
				jobId: job.id,
				stage: sending ? "submit" : "prepare-inputs",
				code,
				httpStatus: error instanceof ComfyError ? error.httpStatus : null,
				requestId: error instanceof ComfyError ? error.requestId : null,
			}),
		);
		if (!sending || rejected)
			return updateJob(job.id, (current) => ({
				...current,
				status: "failed",
				completedAt: Date.now(),
				percent: null,
				errorCode: code,
				message: `Comfy could not accept this render (${code}). No video was generated.`,
			}));
		return updateJob(job.id, (current) => ({
			...current,
			status: "unknown",
			providerJobId: null,
			completedAt: null,
			percent: null,
			errorCode: "submission_unknown",
			message:
				"Submission was interrupted before its Comfy ID was saved. Check the Comfy queue before starting another render; this request will not be submitted again automatically.",
		}));
	}
}

function progressValue(progress: Progress | null) {
	return progress
		? Math.min(99, Math.max(0, Math.floor(progress.value * 100)))
		: null;
}
function observe(
	id: string,
	provider: Job,
	progress = provider.progress,
	status: Job["status"] = provider.status,
) {
	return updateJob(id, (current) => {
		if (current.providerJobId === null) return current;
		const providerJobId = current.providerJobId;
		if (["failed", "canceled", "expired"].includes(status))
			return {
				...current,
				status: "failed",
				completedAt: provider.completedAt?.getTime() ?? Date.now(),
				percent: null,
				errorCode: provider.error?.code ?? status,
				message: `Comfy render ${status}: ${provider.error?.message ?? "No output is available"}`,
			};
		if (status === "succeeded" || current.status === "downloading")
			return {
				...current,
				providerJobId,
				status: "downloading",
				completedAt: null,
				percent: 99,
				message: "Generation finished. Downloading and checking the MP4.",
			};
		return {
			...current,
			providerJobId,
			status: status === "queued" ? "queued" : "running",
			startedAt: provider.startedAt?.getTime() ?? current.startedAt,
			completedAt: null,
			percent: progressValue(progress) ?? current.percent,
			message:
				progress?.message ??
				progress?.currentNodeClass ??
				(status === "queued" ? "Queued on Comfy" : "Rendering on Comfy"),
		};
	});
}

async function collect(
	id: string,
	provider: Job,
	signal?: AbortSignal,
): Promise<JobRow> {
	const existing = downloads.get(id);
	if (existing) return existing;
	const pending = (async () => {
		const primary = provider
			.getOutputs("246")
			.find(
				(output) =>
					output.contentType === "video/mp4" || output.name.endsWith(".mp4"),
			);
		if (!primary)
			return updateJob(id, (current) => ({
				...current,
				status: "failed",
				percent: null,
				completedAt: Date.now(),
				errorCode: "missing_video_output",
				message: "Comfy reported success without the template's MP4 output.",
			}));
		const output = await saveVideoOutput(id, primary, signal);
		return updateJob(id, (current) => {
			if (current.providerJobId === null)
				throw new Error("Missing provider ID for completed render");
			return {
				...current,
				status: "complete",
				providerJobId: current.providerJobId,
				completedAt: provider.completedAt?.getTime() ?? Date.now(),
				percent: 100,
				message: "Render complete. MP4 saved and verified.",
				output,
			};
		});
	})();
	downloads.set(id, pending);
	try {
		return await pending;
	} finally {
		if (downloads.get(id) === pending) downloads.delete(id);
	}
}

export async function reconcileJob(id: string, signal?: AbortSignal) {
	const row = findJob(id);
	if (
		!row ||
		row.status === "complete" ||
		row.status === "failed" ||
		row.status === "unknown"
	)
		return row;
	if (row.providerJobId === null) {
		if (Date.now() - Date.parse(row.createdAt) > 300000)
			return updateJob(id, (current) => ({
				...current,
				status: "unknown",
				providerJobId: null,
				percent: null,
				completedAt: null,
				errorCode: "submission_unknown",
				message:
					"No Comfy ID was recorded before the submission stopped. Check Comfy before starting another render.",
			}));
		return row;
	}
	signal?.throwIfAborted();
	const provider = await client().jobs.get(row.providerJobId);
	signal?.throwIfAborted();
	const snapshot = observe(id, provider);
	return provider.status === "succeeded"
		? collect(id, provider, signal)
		: snapshot;
}

export async function* jobUpdates(
	id: string,
	signal: AbortSignal,
): AsyncGenerator<JobRow> {
	signal.throwIfAborted();
	let row = findJob(id);
	if (!row) throw new Error("Render not found");
	yield row;
	while (row.status === "submitting") {
		await delay(1000, undefined, { signal });
		row = await reconcileJob(id, signal);
		if (!row) throw new Error("Render not found");
		yield row;
	}
	if (
		row.status === "complete" ||
		row.status === "failed" ||
		row.status === "unknown"
	)
		return;
	const provider = await client().jobs.get(row.providerJobId);
	signal.throwIfAborted();
	let status = provider.status;
	for await (const event of provider.events(signal)) {
		if (event.kind === "progress") yield observe(id, provider, event, status);
		if (event.kind === "statusChange") {
			status = event.status;
			yield observe(id, provider, undefined, status);
		}
	}
	await provider.refresh(signal);
	const snapshot = observe(id, provider);
	yield provider.status === "succeeded"
		? await collect(id, provider, signal)
		: snapshot;
}
