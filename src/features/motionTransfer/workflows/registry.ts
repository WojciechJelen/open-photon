import { resolve } from "node:path";

import { loadRuntimeWorkflow } from "../../../shared/server/comfy-workflows.ts";
import { motionTransferParamsSchema } from "./params.ts";

/**
 * The motion-transfer v1 workflow (`loadRuntimeWorkflow`), its inputs map keyed by the params of
 * `motionTransferParamsSchema`. Resolved from the working directory, like the migrations; the
 * Dockerfile copies it.
 */
export const motionTransferWorkflow = loadRuntimeWorkflow(
  resolve("src/features/motionTransfer/workflows/motion-transfer.v1.json"),
  motionTransferParamsSchema.keyof().options,
);

/** Expected model hashes and licenses for new recipes, from the workflow's sibling `models.lock`. */
export const motionTransferModels = motionTransferWorkflow.models;
