import type { Asset } from "./contracts.ts";

// The extension each stored MIME type is saved under (`src/server/media/probe.ts`); `/media/*`
// answers only to the stored file's own. A Map: the key is an asset's runtime `mime` string.
const extensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
]);

/** Where `/media/*` serves an asset. */
export function mediaUrl(asset: Pick<Asset, "id" | "mime">) {
  const extension = extensions.get(asset.mime);

  if (!extension) {
    throw new Error(`No media extension for ${asset.mime}`);
  }

  return `/media/${asset.id}.${extension}`;
}
