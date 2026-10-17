import { z } from "zod";

export const presetSchema = z.enum(["cinematic", "portrait"]);

export const studioSearchSchema = z.object({
	preset: presetSchema.catch("cinematic"),
	take: z.coerce.number().int().min(1).max(9).catch(1),
});

export const newJobSchema = z.object({
	prompt: z.string().trim().min(1, "Write a prompt first.").max(500),
	preset: presetSchema,
	take: z.number().int().min(1).max(9),
});

export const jobRowSchema = newJobSchema.extend({
	id: z.uuid(),
	createdAt: z.iso.datetime(),
});

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
