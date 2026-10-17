import { z } from "zod";

export const presetSchema = z.enum(["cinematic", "portrait"]);

export const studioSearchSchema = z.object({
	preset: presetSchema.catch("cinematic"),
	take: z.coerce.number().int().min(1).max(9).catch(1),
	job: z.uuid().optional().catch(undefined),
});

export const newJobSchema = z.object({
	prompt: z.string().trim().min(1, "Write a prompt first.").max(500),
	preset: presetSchema,
	take: z.number().int().min(1).max(9),
});

const jobBaseSchema = newJobSchema.extend({
	id: z.uuid(),
	createdAt: z.iso.datetime(),
	startedAt: z.number().int(),
	durationMs: z.number().int().positive(),
});

export const jobRowSchema = z.discriminatedUnion("status", [
	jobBaseSchema.extend({
		status: z.literal("running"),
		completedAt: z.null(),
		percent: z.number().int().min(0).max(99),
	}),
	jobBaseSchema.extend({
		status: z.literal("complete"),
		completedAt: z.number().int(),
		percent: z.literal(100),
	}),
]);
export type JobRow = z.infer<typeof jobRowSchema>;

export const jobEventSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("progress"),
		jobId: z.uuid(),
		percent: z.number().int().min(0).max(99),
	}),
	z.object({
		kind: z.literal("complete"),
		jobId: z.uuid(),
		percent: z.literal(100),
	}),
]);

export type NewJob = z.infer<typeof newJobSchema>;
export type JobEvent = z.infer<typeof jobEventSchema>;
