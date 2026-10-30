// The curated motion presets (DEV-289): versioned, each a ready-made Motion Transfer shot (a
// sample motion, a look and a seed) that a visitor finishes with a character. Client-safe and
// loadable by Node as is (relative `.ts` imports), so `npm run test:server` validates it.
import { z } from "zod";

import { parseDraft } from "../motionTransfer/api.ts";

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** What the visitor must add before a preset renders; a preset never chooses a character. */
const requiredInputSchema = z.enum(["character"]);

export type RequiredInput = z.infer<typeof requiredInputSchema>;

/**
 * One version of a preset. Everything that decides a render is concrete here (the motion by its
 * clip's SHA-256, the whole look, the seed, the workflow version), never "the workflow's
 * default", so a change elsewhere cannot change what the preset renders. Bump `version` whenever
 * any of it changes: a link or a request naming another version is refused as stale before
 * anything is submitted, and every take records the version it was made from.
 *
 * - `workflow`: the Motion Transfer workflow version the preset was made for (presets prefill
 *   Motion Transfer only); a server that does not run it shows the preset as unavailable.
 * - `motion`: a sample motion (`src/features/motionTransfer/samples/motions/manifest.json`) by
 *   slug, title and clip SHA-256, with its licence and attribution as the manifest has them.
 * - `defaults`: the look (`prompt`, at most 500 characters, as Motion Transfer takes it) and the
 *   seed the preset fills in; the visitor may change both.
 * - `requires`: what the visitor adds (a character).
 * - `example`: a real output of the preset's motion, look and seed with a sample character: the
 *   preview and its poster in `samples/` (re-encoded from the output whose SHA-256 is
 *   `output_sha256`), the character, and where the render came from; `samples/README.md` records
 *   how each was made.
 */
export const presetSchema = z
  .strictObject({
    id: slugSchema,
    version: z.int().positive(),
    title: z.string().trim().min(1).max(60),
    summary: z.string().trim().min(1).max(240),
    workflow: z.strictObject({ id: z.literal("motion-transfer"), version: z.int().positive() }),
    motion: z.strictObject({
      attribution: z.string().min(1),
      license: z.string().min(1),
      sha256: sha256Schema,
      slug: slugSchema,
      title: z.string().min(1),
    }),
    defaults: z.strictObject({ prompt: z.string(), seed: z.int() }),
    requires: z.array(requiredInputSchema).min(1),
    example: z.strictObject({
      character: z.strictObject({ license: z.string().min(1), title: z.string().min(1) }),
      output_sha256: sha256Schema,
      poster: z.string().regex(/^[a-z0-9-]+\.jpg$/),
      render: z.string().min(1),
      video: z.string().regex(/^[a-z0-9-]+\.mp4$/),
    }),
  })
  .superRefine(({ defaults }, context) => {
    // The defaults must be a draft Motion Transfer keeps whole (`parseDraft` drops what it
    // would refuse): a look of 1–500 characters once trimmed, a seed it accepts.
    const draft = parseDraft(defaults);

    if (draft.prompt !== defaults.prompt || defaults.prompt.trim() === "") {
      context.addIssue({
        code: "custom",
        message: "The look must be 1–500 characters once trimmed, as Motion Transfer takes it",
        path: ["defaults", "prompt"],
      });
    }

    if (draft.seed !== defaults.seed) {
      context.addIssue({
        code: "custom",
        message: `The seed must be a whole number from 0 to ${Number.MAX_SAFE_INTEGER}`,
        path: ["defaults", "seed"],
      });
    }
  });

export type Preset = z.output<typeof presetSchema>;

/** A catalog: at least three presets, each id once. */
export const presetCatalogSchema = z
  .array(presetSchema)
  .min(3)
  .superRefine((presets, context) => {
    const seen = new Set<string>();

    for (const [index, { id }] of presets.entries()) {
      if (seen.has(id)) {
        context.addIssue({
          code: "custom",
          message: `Two presets are "${id}"`,
          path: [index, "id"],
        });
      }

      seen.add(id);
    }
  });

const streetDance = {
  attribution:
    "street_dance_drive.mp4 from Comfy-Org/workflow_templates@7d8ed32f0bf6b8d52129976535422d6f518fe463 (input/), MIT licensed; see src/features/motionTransfer/workflows/wan-animate-2/LICENSE.upstream",
  license: "MIT",
  sha256: "affc8c474a68b5c17c9f38d80afc689606577ac0951a95097d33f13006c90bd8",
  slug: "street-dance",
  title: "Street dance",
};

const sampleLicense =
  "FLUX Kommunity License v1.0 (sample character rendered with FLUX 3 Image Klein)";

const motionTransfer = { id: "motion-transfer", version: 1 };

/** The shipped catalog. */
export const presets: readonly Preset[] = presetCatalogSchema.parse([
  {
    id: "street-dance",
    version: 1,
    title: "Street dance",
    summary: "The clip as shot, with your character in it.",
    workflow: motionTransfer,
    motion: streetDance,
    defaults: {
      prompt:
        "The character from the reference image, as it appears there. Background as in the reference image.",
      seed: 20261019,
    },
    requires: ["character"],
    example: {
      character: { license: sampleLicense, title: "Maya" },
      poster: "street-dance.jpg",
      render:
        "DEV-280 pre-rendered sample take, Wan Animate 2 on Comfy Cloud (staging share page /r/1f974b0893944ea0)",
      video: "street-dance.mp4",
      output_sha256: "8ee246f9fb728bc982a7314104517b604189dfb9c25e8eeb7478a45cc2736392",
    },
  },
  {
    id: "neon-night",
    version: 1,
    title: "Neon night",
    summary: "A neon-lit city street after dark.",
    workflow: motionTransfer,
    motion: streetDance,
    defaults: {
      prompt:
        "The character from the reference image, as it appears there. Background: a neon-lit city street at night.",
      seed: 20261019,
    },
    requires: ["character"],
    example: {
      character: { license: sampleLicense, title: "Kenji" },
      poster: "neon-night.jpg",
      render:
        "Wan Animate 2 on Comfy Cloud, 2026-10-23, generation 0e7434c6-cd82-433d-8607-9760a17bc6b9",
      video: "neon-night.mp4",
      output_sha256: "a32f2abdcbc273a0da01128bd414947c7413d2fb5d11f838efc743447b012dd3",
    },
  },
  {
    id: "golden-hour-rooftop",
    version: 1,
    title: "Golden-hour rooftop",
    summary: "A rooftop in warm evening light.",
    workflow: motionTransfer,
    motion: streetDance,
    defaults: {
      prompt:
        "The character from the reference image, as it appears there. Background: a rooftop at golden hour.",
      seed: 20261019,
    },
    requires: ["character"],
    example: {
      character: { license: sampleLicense, title: "Rosa" },
      poster: "golden-hour-rooftop.jpg",
      render:
        "Wan Animate 2 on Comfy Cloud, 2026-10-23, generation 9b131eba-292f-401c-be1e-5e4fdb5d25b0",
      video: "golden-hour-rooftop.mp4",
      output_sha256: "a3045fa61e10e7d5e6f8a51145d7b1e94634ab5a9e4b28958ab2f1de4a0db754",
    },
  },
]);

/** The preset `id` names in `catalog`, or `undefined`. */
export function findPreset(id: string, catalog: readonly Preset[] = presets) {
  return catalog.find((preset) => preset.id === id);
}
