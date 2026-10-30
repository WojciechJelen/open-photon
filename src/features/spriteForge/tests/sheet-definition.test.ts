import "../../../../tests/temp-database.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import type { AssetReference } from "../../../shared/server/comfy-assets.ts";
import type { ProviderTarget } from "../../../shared/server/comfy-target.ts";
import { database } from "../../../shared/server/db.server.ts";
import { startDispatcher } from "../../../shared/server/generation/dispatcher.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { findGeneration, readOutputs } from "../../../shared/server/generation/generations.ts";
import { submitMany } from "../../../shared/server/generation/service.ts";
import type { WorkflowGraph } from "../../../shared/server/workflow-graph.ts";
import { getCharacter } from "../../characters/api.ts";
import {
  defaultFacing,
  type SheetFacing,
  type SheetTakes,
  SPRITE_SHEET_WORKFLOW,
  spriteDirections,
  spriteSheetInputSchema,
  VIEW_OUTPUT,
} from "../contracts.ts";
import { keepFirstTake, spriteSheetDefinition } from "../workflows/sheet-definition.ts";
import { spriteViewDefinition } from "../workflows/view-definition.ts";

// The fake provider on a dead self-hosted port, so nothing can reach a real Comfy and the views a
// test admits finish in process.
Object.assign(process.env, {
  COMFY_API_KEY: "",
  COMFY_BASE_URL: "http://127.0.0.1:1",
  COMFY_FAKE_STEP_MS: "0",
  COMFY_PROVIDER: "fake",
  COMFY_PROXY_TOKEN: "",
  GENERATE_RATE_LIMIT: "1000",
  IN_FLIGHT_MAX: "5",
});

const selfhost: ProviderTarget = { kind: "selfhost", origin: "http://127.0.0.1:1" };
const cloud: ProviderTarget = { kind: "cloud", origin: null };

/** Two seeded sample characters, generated ones whose images are stored. */
const [first = "", second = ""] = z
  .array(z.object({ id: z.uuid() }))
  .parse(
    database.prepare("SELECT id FROM characters WHERE is_sample = 1 ORDER BY slug LIMIT 2").all(),
  )
  .map(({ id }) => id);

/**
 * What `assert.throws` matches a refusal against: the `GenerateError` (its constructor) with this
 * status and reason.
 */
const refusal = (status: number, reason?: string) => ({
  constructor: GenerateError,
  reason,
  status,
});

/**
 * Admits the five views of `characterId` with `seed` as a set does (one `submitMany` under a new
 * request key, paid by a newly minted code), by direction; they wait for a dispatcher.
 */
function admitViews(characterId: string, seed: number) {
  const codeId = findAccessCode(mintCode(10))?.id ?? "";

  const receipts = submitMany(
    spriteViewDefinition,
    spriteDirections.map((direction) => ({ character_id: characterId, direction, seed })),
    { requestKey: randomUUID(), scope: { free: () => false, session: { codeId } } },
  );

  return spriteSheetInputSchema.shape.views.parse(
    Object.fromEntries(
      spriteDirections.map((direction, index) => [direction, receipts[index]?.id]),
    ),
  );
}

/** Waits until none of `ids` is still on its way, reading the database only, and their statuses. */
async function finalStatuses(ids: readonly string[]) {
  const final: string[] = ["cancelled", "done", "failed", "unknown"];
  const deadline = Date.now() + 60_000;

  let statuses = ids.map((id) => findGeneration(id)?.status ?? "missing");

  while (!statuses.every((status) => final.includes(status))) {
    assert.ok(Date.now() < deadline, `the views never finished: ${statuses.join(", ")}`);
    await delay(20);
    statuses = ids.map((id) => findGeneration(id)?.status ?? "missing");
  }

  return statuses;
}

test("each direction's view asks for its own angle of the character's image, and an unknown character is a 404", () => {
  const character = getCharacter(first);

  assert.ok(character);

  const prepared = spriteDirections.map((direction) =>
    spriteViewDefinition.prepareRecipe(
      { character_id: first, direction, seed: 31 },
      { target: selfhost },
    ),
  );

  assert.deepEqual(
    prepared.map(({ characterId, recipe }) => ({
      characterId,
      prompt: recipe.prompt,
      reference: recipe.reference_image_sha256,
      seed: recipe.seed,
    })),
    [
      "<sks> front view eye-level shot medium shot",
      "<sks> front-right quarter view eye-level shot medium shot",
      "<sks> right side view eye-level shot medium shot",
      "<sks> back-right quarter view eye-level shot medium shot",
      "<sks> back view eye-level shot medium shot",
    ].map((prompt) => ({
      characterId: character.id,
      prompt,
      reference: character.image.sha256,
      seed: 31,
    })),
  );
  assert.throws(
    () =>
      spriteViewDefinition.prepareRecipe(
        { character_id: randomUUID(), direction: "w" },
        { target: selfhost },
      ),
    refusal(404),
  );
});

test("a sheet is refused on Comfy Cloud and forged on a self-hosted target from five done views", async () => {
  const views = admitViews(first, 880_001);
  const dispatcher = startDispatcher({ intervalMs: 20 });

  try {
    assert.deepEqual(
      await finalStatuses(Object.values(views)),
      spriteDirections.map(() => "done"),
    );
  } finally {
    await dispatcher.stop();
  }

  const input = { facing: defaultFacing, seed: 12_345, takes: 3 as const, views };

  assert.throws(
    () => spriteSheetDefinition.prepareRecipe(input, { target: cloud }),
    refusal(422, "selfhost_required"),
  );

  const { characterId, recipe } = spriteSheetDefinition.prepareRecipe(input, { target: selfhost });

  const storedImage = (id: string) =>
    readOutputs(id).find(({ name }) => name === VIEW_OUTPUT)?.asset.sha256;

  assert.equal(characterId, first);
  assert.deepEqual(
    recipe.views,
    Object.fromEntries(
      spriteDirections.map((direction) => [direction, storedImage(views[direction])]),
    ),
  );
  assert.deepEqual(
    { facing: recipe.facing, seed: recipe.seed, takes: recipe.takes, target: recipe.target },
    { facing: defaultFacing, seed: 12_345, takes: 3, target: "selfhost" },
  );

  // A retry renders again only where the custom nodes are.
  assert.equal(spriteSheetDefinition.rebase(recipe, { seed: 7, target: cloud }), null);
  assert.equal(spriteSheetDefinition.rebase(recipe, { seed: 7, target: selfhost })?.seed, 7);
});

test("a sheet refuses a view generation that does not exist or is not done", () => {
  // No dispatcher runs now, so these views stay waiting.
  const waiting = admitViews(second, 880_002);
  const input = { facing: defaultFacing, takes: 1 as const };

  assert.throws(
    () =>
      spriteSheetDefinition.prepareRecipe(
        { ...input, views: { ...waiting, s: randomUUID() } },
        { target: selfhost },
      ),
    refusal(404, "view_not_found"),
  );
  assert.throws(
    () => spriteSheetDefinition.prepareRecipe({ ...input, views: waiting }, { target: selfhost }),
    refusal(409, "view_not_done"),
  );
});

/** The uploaded view references `buildGraph` gets, by input name. */
const viewRefs = Object.fromEntries(
  spriteDirections.map((direction): [string, AssetReference] => [
    `view_${direction}`,
    { __type: "core/ASSET", info: { id: `uploaded-${direction}` } },
  ]),
);

const SEED = 41_000;

/** The sheet graph Comfy gets for these choices. */
function sheetGraph(takes: SheetTakes, facing: SheetFacing) {
  const recipe = spriteSheetDefinition.recipeSchema.parse({
    facing,
    models: spriteSheetDefinition.models,
    seed: SEED,
    takes,
    target: "selfhost",
    views: Object.fromEntries(
      spriteDirections.map((direction, index) => [direction, String(index).repeat(64)]),
    ),
    workflow: {
      id: SPRITE_SHEET_WORKFLOW,
      sha256: spriteSheetDefinition.workflowHash,
      version: spriteSheetDefinition.version,
    },
  });

  return spriteSheetDefinition.buildGraph(recipe, viewRefs);
}

/** The take a node renders by the sheet graph's id rule; `0` for a take-independent one. */
const takeOf = (id: string) => (Number(id) >= 1000 ? Math.floor((Number(id) % 1000) / 100) : 0);

/** Each take's high-noise sampler (the one that adds noise): its node id and noise seed. */
function noiseSeeds(graph: WorkflowGraph) {
  return Object.entries(graph)
    .filter(
      ([, node]) => node.class_type === "KSamplerAdvanced" && node.inputs.add_noise === "enable",
    )
    .map(([id, node]) => ({ id, seed: node.inputs.noise_seed }));
}

/** Every node input linking to a node the graph does not have, as `<node>.<field> → <id>`. */
function danglingLinks(graph: WorkflowGraph) {
  return Object.entries(graph).flatMap(([id, node]) =>
    Object.entries(node.inputs).flatMap(([field, value]) => {
      // A link is `[source node id, output index]`.
      const source = Array.isArray(value) ? value[0] : undefined;

      return typeof source === "string" && !(source in graph) ? [`${id}.${field} → ${source}`] : [];
    }),
  );
}

/** The rows' `flip_horizontal`, in atlas row order (s, sw, w, nw, n, ne, e, se). */
const rowFlips = (graph: WorkflowGraph) =>
  ["901", "902", "903", "904", "905", "906", "907", "908"].map(
    (id) => graph[id]?.inputs.flip_horizontal,
  );

/** What each direction's `LoadImage` loads, in direction order, and what it should load. */
function loadedViews(graph: WorkflowGraph) {
  return {
    expected: spriteDirections.map((direction) => viewRefs[`view_${direction}`]),
    loaded: ["1001", "2001", "3001", "4001", "5001"].map((id) => graph[id]?.inputs.image),
  };
}

test("a three-take sheet graph loads each view, seeds take t with seed + t - 1, and flips the rows facing the wrong way", () => {
  const graph = sheetGraph(3, { nw: "right", sw: "right", w: "left" });
  const views = loadedViews(graph);

  assert.deepEqual(views.loaded, views.expected);

  const seeds = noiseSeeds(graph);

  assert.deepEqual(
    seeds.map(({ id }) => takeOf(id)).sort((a, b) => a - b),
    [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3],
  );
  assert.deepEqual(
    seeds.map(({ seed }) => seed),
    seeds.map(({ id }) => SEED + takeOf(id) - 1),
  );

  // West rows flip a view facing right, east rows (their mirrors) one facing left.
  assert.deepEqual(rowFlips(graph), [false, true, false, true, false, false, true, false]);
  assert.deepEqual(rowFlips(sheetGraph(3, defaultFacing)), [
    false,
    false,
    false,
    false,
    false,
    true,
    true,
    true,
  ]);
  assert.deepEqual(danglingLinks(graph), []);
});

test("a one-take sheet graph renders take 1 only, with no loop cut waiting for another take and no broken link", () => {
  const graph = sheetGraph(1, defaultFacing);
  const loopCuts = Object.values(graph).filter(({ class_type }) => class_type === "SpriteLoopCut");
  const views = loadedViews(graph);

  assert.deepEqual(
    Object.keys(graph).filter((id) => takeOf(id) > 1),
    [],
  );
  assert.equal(loopCuts.length, 5);
  assert.deepEqual(
    loopCuts.flatMap(({ inputs }) =>
      ["frames_2", "mask_2", "frames_3", "mask_3"].filter((name) => name in inputs),
    ),
    [],
  );
  assert.deepEqual(danglingLinks(graph), []);
  assert.deepEqual(
    noiseSeeds(graph).map(({ seed }) => seed),
    spriteDirections.map(() => SEED),
  );
  assert.deepEqual(views.loaded, views.expected);

  // Pruning a bound three-take graph gives the same graph and leaves the one it was given whole.
  const full = sheetGraph(3, defaultFacing);
  const untouched = structuredClone(full);

  assert.deepEqual(keepFirstTake(full), graph);
  assert.deepEqual(full, untouched);
});
