// What a batch's pages call it. Pure, client-safe and loadable by Node.
import type { BatchKind } from "./contracts.ts";

/** A batch's title: what it varies, and how many. */
export function batchTitle(kind: BatchKind, takes: number) {
  return `${takes} ${kind === "seeds" ? "seeds" : "characters"}, one shot`;
}
