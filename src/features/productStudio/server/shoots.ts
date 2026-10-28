// A shoot's admission and reads. Admission is the generation service's (`submitMany`: every shot
// validated, quota checked and stored `waiting` at once, or nothing); the dispatcher renders the
// shots within `IN_FLIGHT_MAX` with no browser open. This module only records which generations
// make up a shoot, under the request key that admitted them.
import type { Session } from "../../../shared/server/access.server.ts";
import { findAsset } from "../../../shared/server/assets.ts";
import type { Provider } from "../../../shared/server/comfy-provider.ts";
import { database } from "../../../shared/server/db.server.ts";
import { GenerateError } from "../../../shared/server/generation/errors.ts";
import { findGeneration, snapshot } from "../../../shared/server/generation/generations.ts";
import { type Admit, submitMany } from "../../../shared/server/generation/service.ts";
import { transaction } from "../../../shared/server/migrate.ts";
import {
  type CreateShootInput,
  createShootInputSchema,
  type Shoot,
  type ShootList,
  shootListSchema,
  shootSchema,
} from "../contracts.ts";
import { productShotDefinition } from "../workflows/definition.ts";
import {
  findShoot,
  findShootByKey,
  findShots,
  insertShoot,
  listShoots,
  type ShootRow,
} from "./repository.ts";

// How many shoots `GET /api/product-shots` lists.
const LISTED = 24;

/** The product photo of a stored shoot; it is never deleted while a shoot names it. */
function productOf(shoot: ShootRow) {
  const image = findAsset(shoot.product_asset_id);

  if (!image) {
    throw new Error(`Shoot ${shoot.id} names no stored product photo`);
  }

  return { image, name: shoot.product };
}

/** A shoot with every shot's current generation (`shootSchema`); `null` for an id no shoot has. */
export function readShoot(id: string): Shoot | null {
  const shoot = findShoot(id);

  if (!shoot) {
    return null;
  }

  const items = findShots(shoot.id).map((shot) => {
    const row = findGeneration(shot.current_id);

    if (!row) {
      throw new Error(`Shoot ${shoot.id} shot ${shot.position} names no stored generation`);
    }

    return {
      attempt: shot.attempt,
      generation: snapshot(row),
      position: shot.position,
      preset: shot.preset,
    };
  });

  return shootSchema.parse({
    created_at: shoot.created_at,
    description: shoot.description,
    format: shoot.format,
    id: shoot.id,
    items,
    product: productOf(shoot),
  });
}

/**
 * Admits a shoot for `input` under the client's `requestKey`, in one transaction: a shoot this
 * key admitted before comes back as it is (`created: false`) and nothing is stored or charged, a
 * key another access code used is a 409; otherwise one product shot per preset goes through
 * `submitMany` (each validated, the quota checked for every new one, all stored `waiting` or
 * none; an existing shot with the same recipe comes back free) and the shoot is stored with its
 * shots in order. Any refusal stores nothing. `admit` is the request's rate limit.
 */
export function createShoot(
  input: CreateShootInput,
  {
    admit,
    provider,
    requestKey,
    session,
  }: { admit?: Admit; provider?: Provider; requestKey: string; session: Session | null },
) {
  if (!session) {
    throw new GenerateError(401, "Enter an access code to do this.", "access_required");
  }

  const shoot = createShootInputSchema.parse(input);

  return transaction(database, () => {
    const existing = findShootByKey(requestKey);

    if (existing) {
      if (existing.access_code_id !== session.codeId) {
        throw new GenerateError(
          409,
          "This request key was used for another request. Send a new one.",
          "request_key_conflict",
        );
      }

      return { created: false, shoot: readShoot(existing.id) };
    }

    const receipts = submitMany(
      productShotDefinition,
      shoot.presets.map((preset) => ({
        description: shoot.description,
        format: shoot.format,
        preset,
        product: shoot.product,
        product_asset_id: shoot.product_asset_id,
      })),
      { admit, provider, requestKey, scope: { free: () => false, session } },
    );

    const id = insertShoot({
      accessCodeId: session.codeId,
      description: shoot.description ?? null,
      format: shoot.format,
      items: shoot.presets.map((preset, index) => {
        const receipt = receipts[index];

        if (!receipt) {
          throw new Error(`submitMany answered no generation for shot ${index}`);
        }

        return { generationId: receipt.id, preset, reused: receipt.reused };
      }),
      product: shoot.product,
      productAssetId: shoot.product_asset_id,
      requestKey,
    });

    return { created: true, shoot: readShoot(id) };
  });
}

/** `GET /api/product-shots`: the workspace's latest shoots with their shots' current statuses. */
export function listWorkspaceShoots(): ShootList {
  return shootListSchema.parse({
    shoots: listShoots(LISTED).map((shoot) => {
      const shots = findShots(shoot.id);

      return {
        created_at: shoot.created_at,
        id: shoot.id,
        presets: shots.map(({ preset }) => preset),
        product: productOf(shoot),
        statuses: shots.map(({ current_id }) => findGeneration(current_id)?.status ?? "failed"),
      };
    }),
  });
}
