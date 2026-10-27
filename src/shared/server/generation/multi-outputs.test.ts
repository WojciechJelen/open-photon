import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { crc32, deflateSync } from "node:zlib";

import { z } from "zod";

import { findAsset } from "../assets.ts";
import type { Provider, ProviderJob, ProviderOutput } from "../comfy-provider.ts";
import { providerTarget } from "../comfy-target.ts";
import { assetsDirectory } from "../paths.ts";
import { workflowGraphSchema } from "../workflow-graph.ts";
import {
  type OutputDeclaration,
  recipeIdentitySchema,
  type WorkflowDefinition,
  workflows,
} from "./definition.ts";
import { finalize } from "./finalize.ts";
import {
  addOutputs,
  createGeneration,
  findGeneration,
  isSharedOutput,
  markQueued,
  readOutputs,
  snapshot,
} from "./generations.ts";
import { readGenerationResult, readGenerationShare } from "./pages.ts";

process.env.COMFY_PROVIDER = "fake";

process.env.COMFY_API_KEY = "";

process.env.COMFY_PROXY_TOKEN = "";

process.env.COMFY_BASE_URL = "http://127.0.0.1:1";

const recipeSchema = recipeIdentitySchema.extend({ prompt: z.string().min(1) }).strict();

type Recipe = z.output<typeof recipeSchema>;

/** A test workflow that declares `outputs`; its graph is never sent (finalize gets a double). */
function fileDefinition(
  id: string,
  outputs: readonly OutputDeclaration[],
): WorkflowDefinition<{ prompt: string }, Recipe> {
  const workflow = { id, sha256: "0".repeat(64), version: 1 };

  return {
    assetInputs: () => ({}),
    buildGraph: () =>
      workflowGraphSchema.parse({
        "9": { class_type: "SaveImage", inputs: { filename_prefix: "test", images: ["8", 0] } },
      }),
    id,
    inputSchema: z.object({ prompt: z.string().min(1) }),
    models: [],
    outputs,
    prepareRecipe: ({ prompt }, { target }) => ({
      recipe: { models: [], prompt, target: target.kind, workflow },
    }),
    rebase: (recipe, { target }) => ({ ...recipe, target: target.kind }),
    recipeSchema,
    seedOf: () => 0,
    version: workflow.version,
    workflowHash: workflow.sha256,
  };
}

const imageDefinition = fileDefinition("test-multi-image", [
  { media: "image", name: "image", nodeId: "9" },
]);

const videoDefinition = fileDefinition("test-multi-video", [
  { media: "video", name: "video", nodeId: "9", poster: true },
]);

workflows.register(imageDefinition);

workflows.register(videoDefinition);

/** A 1×1 PNG of one colour: distinct bytes for each colour, so each is its own asset. */
function png(red: number, green: number, blue: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    const crc = Buffer.alloc(4);

    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));

    return Buffer.concat([length, body, crc]);
  };

  // Width 1, height 1, 8-bit RGB, no interlace.
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, red, green, blue]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An image file of the job, as Comfy's jobs API lists a `SaveImage` output. */
function imageOutput(bytes: Buffer, index: number): ProviderOutput {
  return {
    contentType: "image/png",
    name: `test_${String(index + 1).padStart(5, "0")}_.png`,
    sizeBytes: bytes.length,
    toFile: async (path) => {
      await writeFile(path, bytes);

      return path;
    },
    type: "image",
  };
}

/** A video file of the job: the fake provider's MP4. */
function videoOutput(index: number): ProviderOutput {
  return {
    contentType: "video/mp4",
    name: `take_${String(index + 1).padStart(5, "0")}_.mp4`,
    sizeBytes: 0,
    toFile: async (path) => {
      await copyFile("tests/fixtures/fake-output.mp4", path);

      return path;
    },
    type: "video",
  };
}

/** A provider double whose finished job's node 9 yielded `outputs`, in that order. */
function finished(outputs: ProviderOutput[]): Provider {
  const job: ProviderJob = {
    error: null,
    events: () => {
      throw new Error("finalize never subscribes to events");
    },
    getOutputs: (nodeId) => (nodeId === "9" ? outputs : []),
    id: "provider-job",
    status: "succeeded",
  };

  return {
    job: () => Promise.resolve(job),
    submit: () => Promise.reject(new Error("finalize never submits")),
    upload: () => Promise.reject(new Error("finalize never uploads")),
  };
}

/** A queued generation of `definition`, as the dispatcher leaves it once Comfy took the job. */
function queued(definition: WorkflowDefinition<{ prompt: string }, Recipe>) {
  const target = providerTarget();

  const recipe: Recipe = {
    models: [],
    prompt: `A take ${randomUUID()}`,
    target: target.kind,
    workflow: { id: definition.id, sha256: "0".repeat(64), version: 1 },
  };

  return markQueued(createGeneration(definition, { recipe, target }).id, randomUUID()).id;
}

const colours = [png(255, 0, 0), png(0, 255, 0), png(0, 0, 255)];

test("every image a declared node yields is stored, the first under its name and the rest as name-2, name-3", async () => {
  const id = queued(imageDefinition);
  const done = await finalize(id, finished(colours.map(imageOutput)));
  const outputs = readOutputs(id);

  assert.equal(done?.status, "done");
  assert.deepEqual(
    outputs.map(({ media, name }) => ({ media, name })),
    [
      { media: "image", name: "image" },
      { media: "image", name: "image-2" },
      { media: "image", name: "image-3" },
    ],
  );

  // Each file is its own asset, with the bytes Comfy gave in that place.
  for (const [index, output] of outputs.entries()) {
    const stored = findAsset(output.asset.id);

    assert.ok(stored);
    assert.deepEqual(await readFile(resolve(assetsDirectory(), stored.path)), colours[index]);
    // The share page made as it became done makes all three public.
    assert.equal(isSharedOutput(stored), true);
  }

  // The generation's API, `/g/:id` and `/r/:slug` all list the three, in that order.
  assert.deepEqual(done && snapshot(done).outputs.map(({ name }) => name), [
    "image",
    "image-2",
    "image-3",
  ]);
  assert.deepEqual(readGenerationResult(id)?.outputs, outputs);
  assert.deepEqual(
    readGenerationShare(done?.share_slug ?? "", "https://photon.example")?.outputs.map(
      ({ asset }) => asset.id,
    ),
    outputs.map(({ asset }) => asset.id),
  );
});

test("one image is stored under its name alone, as before", async () => {
  const id = queued(imageDefinition);
  const done = await finalize(id, finished([imageOutput(colours[0] ?? Buffer.alloc(0), 0)]));

  assert.equal(done?.status, "done");
  assert.deepEqual(
    readOutputs(id).map(({ name }) => name),
    ["image"],
  );
});

test("further files follow their output in Comfy's order, image-10 after image-9", async () => {
  const id = queued(imageDefinition);

  await finalize(id, finished(colours.map(imageOutput)));

  const [first] = readOutputs(id);

  const later = Object.fromEntries(
    [4, 5, 6, 7, 8, 9, 10, 11].map((place) => [`image-${place}`, first?.asset.id ?? ""]),
  );

  addOutputs(id, later);

  assert.deepEqual(
    readOutputs(id).map(({ name }) => name),
    ["image", ...Array.from({ length: 10 }, (_, index) => `image-${index + 2}`)],
  );
});

test("each video a declared node yields is stored with its own poster; the first stays the final asset", async () => {
  const id = queued(videoDefinition);
  const done = await finalize(id, finished([videoOutput(0), videoOutput(1)]));
  const outputs = readOutputs(id);

  const byName = Object.fromEntries(
    outputs.map(({ asset, media, name }) => [name, { asset, media }]),
  );

  assert.equal(done?.status, "done");
  assert.deepEqual(
    outputs.map(({ media, name }) => ({ media, name })),
    [
      { media: "poster", name: "poster" },
      { media: "poster", name: "poster-2" },
      { media: "video", name: "video" },
      { media: "video", name: "video-2" },
    ],
  );
  assert.equal(findGeneration(id)?.final_asset_id, byName.video?.asset.id);
  assert.equal(findGeneration(id)?.poster_asset_id, byName.poster?.asset.id);
});

test("a definition may not declare a name that further files of another output are stored under", () => {
  const cases: Array<[OutputDeclaration[], RegExp]> = [
    [
      [
        { media: "image", name: "image", nodeId: "9" },
        { media: "image", name: "image-2", nodeId: "10" },
      ],
      /names an output "image-2", a name further files of "image" are stored under/,
    ],
    [
      [
        { media: "video", name: "video", nodeId: "9", poster: true },
        { media: "text", name: "poster-3", nodeId: "10" },
      ],
      /names an output "poster-3", a name further files of "poster" are stored under/,
    ],
  ];

  for (const [index, [outputs, message]] of cases.entries()) {
    assert.throws(
      () => workflows.register(fileDefinition(`test-clash-${index}`, outputs)),
      message,
    );
  }

  // A text output's name is not a file output's: its further texts are never stored.
  assert.doesNotThrow(() =>
    workflows.register(
      fileDefinition("test-text-suffix", [
        { media: "text", name: "caption", nodeId: "2" },
        { media: "image", name: "caption-2", nodeId: "9" },
      ]),
    ),
  );
});
