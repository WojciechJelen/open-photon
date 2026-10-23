import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { z } from "zod";

import { findPreset, presetCatalogSchema, presets, presetSchema } from "../catalog.ts";

const samples = resolve("src/features/presets/samples");

const motionsManifest = z
  .object({
    motions: z.array(
      z.object({
        attribution: z.string(),
        license: z.string(),
        slug: z.string(),
        title: z.string(),
        video: z.string(),
      }),
    ),
  })
  .parse(
    JSON.parse(readFileSync("src/features/motionTransfer/samples/motions/manifest.json", "utf8")),
  );

const [first] = presets;

assert.ok(first);

test("the shipped catalog has at least three presets with distinct ids, each a Motion Transfer shot that needs a character", () => {
  assert.ok(presets.length >= 3);
  assert.equal(new Set(presets.map(({ id }) => id)).size, presets.length);

  for (const preset of presets) {
    assert.deepEqual(preset.workflow, { id: "motion-transfer", version: 1 });
    assert.deepEqual(preset.requires, ["character"]);
    assert.ok(preset.version >= 1);
  }

  assert.equal(findPreset("neon-night")?.title, "Neon night");
  assert.equal(findPreset("no-such-preset"), undefined);
});

test("every preset's motion is a shipped sample motion, named, licensed and attributed as its manifest says, by its clip's SHA-256", () => {
  for (const { motion } of presets) {
    const sample = motionsManifest.motions.find(({ slug }) => slug === motion.slug);

    assert.ok(sample, `${motion.slug} is a sample motion`);
    assert.equal(motion.title, sample.title);
    assert.equal(motion.license, sample.license);
    assert.equal(motion.attribution, sample.attribution);
    assert.equal(
      motion.sha256,
      createHash("sha256")
        .update(readFileSync(resolve("src/features/motionTransfer/samples/motions", sample.video)))
        .digest("hex"),
    );
  }
});

test("every preset has its own real example: a shipped H.264 preview and poster, a credited sample character and render, and a distinct output", () => {
  for (const { example } of presets) {
    assert.ok(existsSync(resolve(samples, example.video)), example.video);
    assert.ok(existsSync(resolve(samples, example.poster)), example.poster);
    // An MP4 (ISO BMFF `ftyp` box) and a JPEG (SOI marker).
    assert.equal(readFileSync(resolve(samples, example.video)).subarray(4, 8).toString(), "ftyp");
    assert.deepEqual(
      [...readFileSync(resolve(samples, example.poster)).subarray(0, 2)],
      [0xff, 0xd8],
    );
    assert.ok(
      existsSync(
        resolve(
          "src/features/characters/samples/characters",
          `${example.character.title.toLowerCase()}.png`,
        ),
      ),
    );
    assert.match(example.character.license, /FLUX Kommunity/);
  }

  assert.equal(new Set(presets.map(({ example }) => example.output_sha256)).size, presets.length);
  assert.equal(new Set(presets.map(({ example }) => example.video)).size, presets.length);
});

test("a preset's look and seed must be what Motion Transfer accepts, and its workflow Motion Transfer's", () => {
  assert.equal(presetSchema.safeParse(first).success, true);

  for (const [change, path] of [
    [{ defaults: { prompt: "x".repeat(501), seed: 1 } }, "defaults.prompt"],
    [{ defaults: { prompt: "   ", seed: 1 } }, "defaults.prompt"],
    [{ defaults: { prompt: " padded ", seed: 1 } }, "defaults.prompt"],
    [{ defaults: { prompt: "A look.", seed: -1 } }, "defaults.seed"],
    [{ defaults: { prompt: "A look.", seed: Number.MAX_SAFE_INTEGER + 1 } }, "defaults.seed"],
    [{ workflow: { id: "character-generation", version: 1 } }, "workflow.id"],
    [{ version: 0 }, "version"],
    [{ id: "Not A Slug" }, "id"],
    [{ requires: [] }, "requires"],
    [{ extra: true }, ""],
  ] as const) {
    // `first` with some members replaced, for the schema to judge.
    const result = presetSchema.safeParse({ ...first, ...change });

    assert.equal(result.success, false, JSON.stringify(change));
    assert.ok(
      result.error?.issues.some((issue) => issue.path.join(".") === path),
      `${JSON.stringify(change)} fails at ${path}: ${JSON.stringify(result.error?.issues)}`,
    );
  }
});

test("a catalog has at least three presets and never one id twice", () => {
  assert.equal(presetCatalogSchema.safeParse(presets).success, true);
  assert.equal(presetCatalogSchema.safeParse(presets.slice(0, 2)).success, false);

  const twice = presetCatalogSchema.safeParse([...presets, first]);

  assert.equal(twice.success, false);
  assert.match(twice.error?.issues[0]?.message ?? "", /Two presets are "street-dance"/);
});
