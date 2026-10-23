// How a batch's variation becomes its items: one Motion Transfer draft per item, derived from the
// common shot with `withSeed` or `withCharacter`. Client-safe and loadable by Node: the variations
// dialog lists the same items the server admits.
import { type DraftSnapshot, withCharacter, withSeed } from "../motionTransfer/api.ts";
import type { BatchItem, BatchVariation } from "./contracts.ts";

/**
 * The items of `variation` over `shot`, in order, each with its draft and what it varies: the
 * shot with each seed, or with each character (its motion, look and seed kept).
 */
export function planItems(
  shot: DraftSnapshot,
  variation: BatchVariation,
): Array<{ draft: DraftSnapshot; variation: BatchItem["variation"] }> {
  return variation.kind === "seeds"
    ? variation.seeds.map((seed) => ({ draft: withSeed(shot, seed), variation: { seed } }))
    : variation.characters.map((id) => ({
        draft: withCharacter(shot, id),
        variation: { character_id: id },
      }));
}
