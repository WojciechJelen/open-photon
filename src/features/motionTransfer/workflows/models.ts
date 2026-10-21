import { z } from "zod";

import type { WorkflowGraph } from "./build-graph.ts";

export const modelsLockSchema = z.strictObject({
  version: z.literal(1),
  models: z
    .array(
      z.strictObject({
        file: z.string().regex(/^[\w.-]+\.safetensors$/),
        directory: z.enum(["diffusion_models", "loras", "text_encoders", "clip_vision", "vae"]),
        url: z
          .string()
          .regex(/^https:\/\/huggingface\.co\/Comfy-Org\/[^/]+\/resolve\/[a-f0-9]{40}\//),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        license: z.literal("Apache-2.0"),
      }),
    )
    .min(1),
});

/** Resolves every model the graph names; missing or ambiguous pins stop a submission. */
export function lockedModels(graph: WorkflowGraph, lock: z.infer<typeof modelsLockSchema>) {
  const pins = new Map(lock.models.map((model) => [model.file, model]));

  if (pins.size !== lock.models.length) {
    throw new Error("models.lock contains duplicate filenames");
  }

  for (const model of pins.values()) {
    if (!model.url.endsWith(`/${model.directory}/${model.file}`)) {
      throw new Error(`Model URL does not match its install path: ${model.file}`);
    }
  }

  return workflowModelFiles(graph).map((file) => {
    const model = pins.get(file);

    if (!model) {
      throw new Error(`Missing model in models.lock: ${file}`);
    }

    return { file, license: model.license, sha256: model.sha256 };
  });
}

/**
 * The model files a graph loads: every loader field (`unet_name`, `lora_name`, `clip_name`,
 * `vae_name`, …) that names a weights file, in graph order, each once.
 */
export function workflowModelFiles(graph: WorkflowGraph) {
  const loaderFields = new Map([
    ["UNETLoader", ["unet_name"]],
    ["VAELoader", ["vae_name"]],
    ["CLIPLoader", ["clip_name"]],
    ["CLIPVisionLoader", ["clip_name"]],
    ["LoraLoaderModelOnly", ["lora_name"]],
  ]);

  const files = Object.values(graph).flatMap(({ class_type, inputs }) => {
    const fields = loaderFields.get(class_type);

    if (fields) {
      return fields.map((field) => z.string().min(1).parse(inputs[field]));
    }

    return Object.entries(inputs).flatMap(([field, value]) => {
      const file = z.string().safeParse(value);

      return field.endsWith("_name") &&
        file.success &&
        /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(file.data)
        ? [file.data]
        : [];
    });
  });

  return [...new Set(files)];
}
