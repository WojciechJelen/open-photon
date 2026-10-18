import { z } from "zod";

export const presetSchema = z.enum(["cinematic", "portrait"]);

export const studioSearchSchema = z.object({
	preset: presetSchema.catch("cinematic"),
	take: z.coerce.number().int().min(1).max(9).catch(1),
	job: z.uuid().optional().catch(undefined),
});

export const newJobSchema = z.object({
	id: z.uuid(),
	prompt: z.string().trim().min(1, "Write a prompt first.").max(500),
	preset: presetSchema,
	take: z.number().int().min(1).max(9),
});

const jobBaseSchema = newJobSchema.extend({
	createdAt: z.iso.datetime(),
	startedAt: z.number().int().nullable(),
	message: z.string(),
});

export const videoOutputSchema = z.object({
	filename: z.string().regex(/^[a-f0-9-]+\.mp4$/),
	posterFilename: z.string().regex(/^[a-f0-9-]+\.jpg$/),
	bytes: z.number().int().positive(),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	durationSeconds: z.number().positive(),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
	assetId: z.string().min(1),
});

export const jobRowSchema = z.discriminatedUnion("status", [
	jobBaseSchema.extend({
		status: z.literal("submitting"),
		providerJobId: z.null(),
		completedAt: z.null(),
		percent: z.null(),
	}),
	jobBaseSchema.extend({
		status: z.enum(["queued", "running", "downloading"]),
		providerJobId: z.string().min(1),
		completedAt: z.null(),
		percent: z.number().int().min(0).max(99).nullable(),
	}),
	jobBaseSchema.extend({
		status: z.literal("complete"),
		providerJobId: z.string().min(1),
		completedAt: z.number().int(),
		percent: z.literal(100),
		output: videoOutputSchema,
	}),
	jobBaseSchema.extend({
		status: z.literal("failed"),
		providerJobId: z.string().nullable(),
		completedAt: z.number().int(),
		percent: z.null(),
		errorCode: z.string(),
	}),
	jobBaseSchema.extend({
		status: z.literal("unknown"),
		providerJobId: z.null(),
		completedAt: z.null(),
		percent: z.null(),
		errorCode: z.literal("submission_unknown"),
	}),
]);
export type JobRow = z.infer<typeof jobRowSchema>;

export const jobEventSchema = z.object({
	kind: z.literal("snapshot"),
	job: jobRowSchema,
});

export type NewJob = z.infer<typeof newJobSchema>;
export type JobEvent = z.infer<typeof jobEventSchema>;
