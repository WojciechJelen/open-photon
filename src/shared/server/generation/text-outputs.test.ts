import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { isPublicRequest } from "../../../app/server.ts";
import { TEXT_OUTPUT_MAX_BYTES } from "../../contracts.ts";
import { findAccessCode } from "../access-codes.ts";
import { findAsset, hashFile } from "../assets.ts";
import type { Provider, ProviderJob, ProviderOutput } from "../comfy-provider.ts";
import { providerTarget } from "../comfy-target.ts";
import { database } from "../db.server.ts";
import { assetsDirectory } from "../paths.ts";
import { workflowGraphSchema } from "../workflow-graph.ts";
import { recipeIdentitySchema, type WorkflowDefinition, workflows } from "./definition.ts";
import { finalize } from "./finalize.ts";
import {
  createGeneration,
  findGeneration,
  isSharedOutput,
  markQueued,
  readOutputs,
  snapshot,
} from "./generations.ts";
import { readGenerationResult, readGenerationShare } from "./pages.ts";
import { readGeneration, submit } from "./service.ts";

process.env.COMFY_PROVIDER = "fake";

process.env.COMFY_FAKE_STEP_MS = "0";

process.env.COMFY_API_KEY = "";

process.env.COMFY_PROXY_TOKEN = "";

process.env.COMFY_BASE_URL = "http://127.0.0.1:1";

process.env.IN_FLIGHT_MAX = "1000";

const session = { codeId: findAccessCode(mintCode(100))?.id ?? "" };
const scope = { free: () => false, session };

const recipeSchema = recipeIdentitySchema.extend({ prompt: z.string().min(1) }).strict();

type TextRecipe = z.output<typeof recipeSchema>;

/**
 * A test workflow whose job saves a text (`SaveText` node 2), and with `image` also saves a
 * still (`SaveImage` node 9): the shape of a caption enhancement, FLUX-agnostic.
 */
function textDefinition(
  id: string,
  image: boolean,
): WorkflowDefinition<{ prompt: string }, TextRecipe> {
  const workflow = { id, sha256: "0".repeat(64), version: 1 };

  return {
    assetInputs: () => ({}),
    buildGraph: ({ prompt }) =>
      workflowGraphSchema.parse({
        "1": { class_type: "PrimitiveStringMultiline", inputs: { value: prompt } },
        "2": {
          class_type: "SaveText",
          inputs: { filename_prefix: "caption", format: "txt", text: ["1", 0] },
        },
        ...(image && {
          "9": { class_type: "SaveImage", inputs: { filename_prefix: "test", images: ["8", 0] } },
        }),
      }),
    id,
    inputSchema: z.object({ prompt: z.string().min(1) }),
    models: [],
    outputs: [
      { media: "text", name: "caption", nodeId: "2" },
      ...(image ? [{ media: "image", name: "image", nodeId: "9" } as const] : []),
    ],
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

const captionDefinition = textDefinition("test-caption", false);
const mixedDefinition = textDefinition("test-caption-image", true);

workflows.register(captionDefinition);

workflows.register(mixedDefinition);

const fixtureText = () => readFile("tests/fixtures/fake-output.txt", "utf8");

test("a text output is stored as a private .txt asset and shown inline by the generation's snapshot", async () => {
  const { id } = await submit(captionDefinition, { prompt: "A dancer" }, { scope });
  const done = await readGeneration(id);
  const text = await fixtureText();

  assert.equal(done?.status, "done");
  assert.deepEqual(done?.outputs, [{ media: "text", name: "caption", text }]);

  const stored = findAsset(outputAssetId(id, "caption"));

  assert.deepEqual(
    [stored?.kind, stored?.role, stored?.mime, stored?.width, stored?.duration_ms],
    ["text", "provider_output", "text/plain; charset=utf-8", null, null],
  );
  assert.ok(stored?.path.endsWith(".txt"));
  assert.equal(stored?.sha256, await hashFile("tests/fixtures/fake-output.txt"));
  assert.equal(await readFile(resolve(assetsDirectory(), stored?.path ?? ""), "utf8"), text);

  // Nothing public: no share page, no file output for the pages, the asset needs a session.
  assert.equal(done?.share_slug, null);
  assert.deepEqual(readOutputs(id), []);
  assert.deepEqual(readGenerationResult(id)?.outputs, []);
  assert.equal(readGenerationShare("0123456789abcdef", "https://photon.example"), null);
  assert.equal(stored && isSharedOutput(stored), false);
  assert.equal(isPublicRequest("GET", `/media/${stored?.id}.txt`), false);

  // The snapshot's outputs come only once it is done.
  const row = findGeneration(id);

  assert.ok(row);
  assert.deepEqual(snapshot({ ...row, status: "running" }).outputs, []);
});

test("a generation with a text and an image output shares the image and keeps the text private", async () => {
  const { id } = await submit(mixedDefinition, { prompt: "A cellist" }, { scope });
  const done = await readGeneration(id);
  const text = await fixtureText();
  const image = findAsset(outputAssetId(id, "image"));
  const caption = findAsset(outputAssetId(id, "caption"));

  assert.equal(done?.status, "done");
  assert.match(done?.share_slug ?? "", /^[0-9a-f]{16}$/);
  assert.deepEqual(
    done?.outputs.map((output) =>
      output.media === "text"
        ? output
        : { id: output.asset.id, media: output.media, name: output.name },
    ),
    [
      { media: "text", name: "caption", text },
      { id: image?.id, media: "image", name: "image" },
    ],
  );
  assert.deepEqual(
    readOutputs(id).map(({ name }) => name),
    ["image"],
  );
  assert.deepEqual(
    readGenerationShare(done?.share_slug ?? "", "https://photon.example")?.outputs.map(
      ({ name }) => name,
    ),
    ["image"],
  );
  assert.equal(isPublicRequest("GET", `/media/${image?.id}.png`), true);
  assert.equal(isPublicRequest("GET", `/media/${caption?.id}.txt`), false);
});

test("the fake provider's scenarios hold for a text workflow", async () => {
  const { id } = await submit(
    captionDefinition,
    { prompt: "[fake:provider_failed] A dancer" },
    { scope },
  );

  const failed = await readGeneration(id);

  assert.deepEqual([failed?.status, failed?.error_code], ["failed", "provider_failed"]);
  assert.deepEqual(failed?.outputs, []);
});

/** A finished job of the caption workflow whose node 2 reported `outputs`. */
function finished(outputs: ProviderOutput[]) {
  const job: ProviderJob = {
    error: null,
    events: () => {
      throw new Error("finalize never subscribes to events");
    },
    getOutputs: (nodeId) => (nodeId === "2" ? outputs : []),
    id: "provider-job",
    status: "succeeded",
  };

  const double: Provider = {
    job: () => Promise.resolve(job),
    submit: () => Promise.reject(new Error("finalize never submits")),
    upload: () => Promise.reject(new Error("finalize never uploads")),
  };

  return double;
}

/** A text output of the job, with `content` as its bytes. */
function textOutput(content: string | Uint8Array): ProviderOutput {
  return {
    // As Comfy's jobs API lists a `SaveText` file: type `file`, no content type, a `.txt` name.
    contentType: "",
    name: "character_caption_00001.txt",
    sizeBytes: typeof content === "string" ? Buffer.byteLength(content) : content.length,
    toFile: async (path) => {
      await writeFile(path, content);

      return path;
    },
    type: "file",
  };
}

/** A queued caption generation, as the dispatcher leaves it once Comfy took the job. */
function queued() {
  const target = providerTarget();

  const recipe: TextRecipe = {
    models: [],
    prompt: `A caption ${randomUUID()}`,
    target: target.kind,
    workflow: { id: captionDefinition.id, sha256: "0".repeat(64), version: 1 },
  };

  return markQueued(createGeneration(captionDefinition, { recipe, target }).id, randomUUID()).id;
}

test("finalize stores the first text output that is not blank, byte for byte", async () => {
  const id = queued();
  const done = await finalize(id, finished([textOutput(" \n"), textOutput("  A caption.\n")]));

  assert.equal(done?.status, "done");
  assert.deepEqual(done && snapshot(done).outputs, [
    { media: "text", name: "caption", text: "  A caption.\n" },
  ]);
});

test("finalize fails a text output that is blank, too long or not UTF-8 at once, and a missing one", async () => {
  const cases = [
    { message: /text output caption is blank/, outputs: [textOutput("\n\t ")] },
    {
      message: new RegExp(`${TEXT_OUTPUT_MAX_BYTES + 1} bytes`),
      outputs: [textOutput("a".repeat(TEXT_OUTPUT_MAX_BYTES + 1))],
    },
    { message: /not UTF-8/, outputs: [textOutput(new Uint8Array([0xff, 0xfe, 0x41]))] },
    { message: /without its text output/, outputs: [] },
  ];

  for (const { message, outputs } of cases) {
    const id = queued();
    const failed = await finalize(id, finished(outputs));

    assert.deepEqual([failed?.status, failed?.error_code], ["failed", "provider_failed"]);
    assert.match(failed?.error_message ?? "", message);
    assert.equal(failed?.finalize_attempts, 0);
    assert.deepEqual(readOutputs(id), []);
  }
});

/** The asset id stored for the output `name` of generation `id`. */
function outputAssetId(id: string, name: string) {
  return String(
    database
      .prepare("SELECT asset_id FROM generation_outputs WHERE generation_id = ? AND name = ?")
      .get(id, name)?.asset_id ?? "",
  );
}
