import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Comfy } from "@comfyorg/sdk";
import { z } from "zod";
import type { NewJob } from "../lib/contracts.ts";

export const workflowGraphSchema = z.record(
	z.string(),
	z.object({
		class_type: z.string().min(1),
		inputs: z.record(z.string(), z.json()),
		_meta: z.object({ title: z.string() }).optional(),
	}),
);

export async function prepareWanWorkflow(client: Comfy, input: NewJob) {
	const graph = workflowGraphSchema.parse(
		JSON.parse(
			await readFile(
				resolve("workflows/wan-animate-2/workflow-api.json"),
				"utf8",
			),
		),
	);
	const workflow = client.workflows.fromJson(graph);
	workflow.setInput(
		"189",
		"image",
		await client.assets
			.fromFile(resolve("fixtures/wan/reference.png"))
			.asReference(),
	);
	workflow.setInput(
		"240",
		"file",
		await client.assets
			.fromFile(resolve("fixtures/wan/driving.mp4"))
			.asReference(),
	);
	workflow.setInput("672:582", "text", input.prompt);
	workflow.setInput("672:597", "noise_seed", 582699151003550 + input.take - 1);
	workflow.setInput(
		"672:600",
		"resize_type.width",
		input.preset === "portrait" ? 482 : 854,
	);
	workflow.setInput(
		"672:600",
		"resize_type.height",
		input.preset === "portrait" ? 854 : 482,
	);
	for (const node of ["246", "292"]) {
		workflow.setInput(node, "filename_prefix", `video/wan-${input.id}`);
		workflow.setInput(node, "format", "mp4");
		workflow.setInput(node, "format.codec", "h264");
		workflow.setInput(node, "codec", "h264");
	}
	return workflow;
}
