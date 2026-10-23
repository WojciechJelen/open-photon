import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import type { WorkflowGraph } from "./workflow-graph.ts";

/**
 * A feature's `models.lock`: every weights file its workflows load, pinned to an immutable
 * Hugging Face revision (a 40-hex commit) of a Comfy-Org repackaging or of Black Forest Labs'
 * FLUX 3 Image Klein ComfyUI repository (gated), with its SHA-256 and licence: Apache-2.0, or the
 * FLUX Kommunity License v1.0 of the FLUX 3 transformer and VAE.
 */
const modelsLockSchema = z.strictObject({
  version: z.literal(1),
  models: z
    .array(
      z.strictObject({
        file: z.string().regex(/^[\w.-]+\.safetensors$/),
        directory: z.enum(["diffusion_models", "loras", "text_encoders", "clip_vision", "vae"]),
        url: z
          .string()
          .regex(
            /^https:\/\/huggingface\.co\/(?:Comfy-Org\/[^/]+|black-forest-labs\/flux-3-image-klein-comfy)\/resolve\/[a-f0-9]{40}\//,
          ),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        license: z.enum(["Apache-2.0", "FLUX-Kommunity-1.0"]),
      }),
    )
    .min(1),
});

type ModelsLock = z.infer<typeof modelsLockSchema>;

/** Reads and validates the `models.lock` at `path`. */
export function readModelsLock(path: string): ModelsLock {
  return modelsLockSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * The `models.lock` beside a runtime workflow; undefined when there is none and the graph loads no
 * model file. A graph that loads model files without a lock throws.
 */
export function workflowModelsLock(
  workflow: { feature: string; id: string; version: number; lockFile: string },
  graph: WorkflowGraph,
) {
  if (existsSync(workflow.lockFile)) {
    return readModelsLock(workflow.lockFile);
  }

  const files = workflowModelFiles(graph);

  if (files.length) {
    throw new Error(
      `Missing models.lock for ${workflow.feature}/${workflow.id}.v${workflow.version}: the graph loads ${files.length} model file(s)`,
    );
  }

  return undefined;
}

/**
 * Every pin across features' locks, each `directory/file` once. Two features may pin the same file
 * identically; pinning it with a different `sha256` or `url` throws, naming both features.
 */
export function aggregateModelsLocks(locks: Array<{ feature: string; lock: ModelsLock }>) {
  const pins = new Map<string, { feature: string; model: ModelsLock["models"][number] }>();

  for (const { feature, lock } of locks) {
    for (const model of lock.models) {
      const key = `${model.directory}/${model.file}`;
      const pinned = pins.get(key);

      if (!pinned) {
        pins.set(key, { feature, model });
      } else if (pinned.model.sha256 !== model.sha256 || pinned.model.url !== model.url) {
        throw new Error(`Conflicting pins for ${key}: ${pinned.feature} and ${feature}`);
      }
    }
  }

  return [...pins.values()].map(({ model }) => model);
}

/** Resolves every model the graph names; missing or ambiguous pins stop a submission. */
export function lockedModels(graph: WorkflowGraph, lock: ModelsLock) {
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
 * Every loader field in a graph that names a weights file (`unet_name`, `lora_name`, `clip_name`,
 * `vae_name`, …): the file, its node class and the field, in graph order, once per reference.
 */
export function workflowModelReferences(graph: WorkflowGraph) {
  const loaderFields = new Map([
    ["UNETLoader", ["unet_name"]],
    ["VAELoader", ["vae_name"]],
    ["CLIPLoader", ["clip_name"]],
    ["CLIPVisionLoader", ["clip_name"]],
    ["LoraLoaderModelOnly", ["lora_name"]],
  ]);

  return Object.values(graph).flatMap(({ class_type, inputs }) => {
    const fields = loaderFields.get(class_type);

    if (fields) {
      return fields.map((field) => ({
        file: z.string().min(1).parse(inputs[field]),
        class_type,
        field,
      }));
    }

    return Object.entries(inputs).flatMap(([field, value]) => {
      const file = z.string().safeParse(value);

      return field.endsWith("_name") &&
        file.success &&
        /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(file.data)
        ? [{ file: file.data, class_type, field }]
        : [];
    });
  });
}

/** The model files a graph loads (`workflowModelReferences`), in graph order, each once. */
export function workflowModelFiles(graph: WorkflowGraph) {
  return [...new Set(workflowModelReferences(graph).map(({ file }) => file))];
}
