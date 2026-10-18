import { z } from "zod";

export const presetSchema = z.enum(["cinematic", "portrait"]);

export const studioSearchSchema = z.object({
  job: z.uuid().optional().catch(undefined),
  preset: presetSchema.catch("cinematic"),
  take: z.coerce.number().int().min(1).max(9).catch(1),
});

export const newJobSchema = z.object({
  id: z.uuid(),
  preset: presetSchema,
  prompt: z.string().trim().min(1, "Write a prompt first.").max(500),
  take: z.number().int().min(1).max(9),
});

const jobBaseSchema = newJobSchema.extend({
  createdAt: z.iso.datetime(),
  message: z.string(),
  startedAt: z.number().int().nullable(),
});

export const videoOutputSchema = z.object({
  assetId: z.string().min(1),
  bytes: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  filename: z.string().regex(/^[a-f0-9-]+\.mp4$/),
  height: z.number().int().positive(),
  posterFilename: z.string().regex(/^[a-f0-9-]+\.jpg$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(),
});

export const jobRowSchema = z.discriminatedUnion("status", [
  jobBaseSchema.extend({
    completedAt: z.null(),
    percent: z.null(),
    providerJobId: z.null(),
    status: z.literal("submitting"),
  }),
  jobBaseSchema.extend({
    completedAt: z.null(),
    percent: z.number().int().min(0).max(99).nullable(),
    providerJobId: z.string().min(1),
    status: z.enum(["queued", "running", "downloading"]),
  }),
  jobBaseSchema.extend({
    completedAt: z.number().int(),
    output: videoOutputSchema,
    percent: z.literal(100),
    providerJobId: z.string().min(1),
    status: z.literal("complete"),
  }),
  jobBaseSchema.extend({
    completedAt: z.number().int(),
    errorCode: z.string(),
    percent: z.null(),
    providerJobId: z.string().nullable(),
    status: z.literal("failed"),
  }),
  jobBaseSchema.extend({
    completedAt: z.null(),
    errorCode: z.literal("submission_unknown"),
    percent: z.null(),
    providerJobId: z.null(),
    status: z.literal("unknown"),
  }),
]);

export type JobRow = z.infer<typeof jobRowSchema>;

export const jobEventSchema = z.object({
  job: jobRowSchema,
  kind: z.literal("snapshot"),
});

export type NewJob = z.infer<typeof newJobSchema>;

export type JobEvent = z.infer<typeof jobEventSchema>;
