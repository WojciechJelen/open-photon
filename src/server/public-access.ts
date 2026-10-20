import { findAsset } from "./assets.ts";
import { database } from "./db.server.ts";
import { isSharedAsset } from "./share.ts";

/**
 * Whether anyone may load this asset without an access code: a sample (a sample motion's clip or
 * a sample character's image, what the picker shows) or a file a share page shows. Uploads, cuts,
 * character photos and unshared results need a session.
 */
export function isPublicAsset(assetId: string) {
  return findAsset(assetId)?.role === "sample" || isSharedAsset(assetId);
}

/**
 * Whether a request without a session may go on to its route: pages, media and reads anyone may
 * `GET`/`HEAD` (the picker `/`, share pages, public media, and the page and API of a pre-rendered
 * sample generation), server functions (each checks access itself: the picker's and the share
 * page's loaders are public, `loadResult` is not), and the two actions that may answer with a
 * result that already exists, for free: `POST /api/generate` (a pre-rendered sample × sample
 * result) and `POST /api/generations/:id/rerun` (a done generation's own result); they refuse
 * anything that would submit a job (`src/server/generate.ts`).
 */
export function isPublicRequest(method: string, pathname: string) {
  if (pathname.startsWith("/_serverFn/")) {
    return true;
  }

  if (method === "POST") {
    return pathname === "/api/generate" || /^\/api\/generations\/[^/]+\/rerun$/.test(pathname);
  }

  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  if (pathname === "/" || /^\/r\/[^/]+$/.test(pathname)) {
    return true;
  }

  const assetId = /^\/media\/([0-9a-f-]{36})\.[a-z0-9]+$/.exec(pathname)?.[1];

  if (assetId !== undefined) {
    return isPublicAsset(assetId);
  }

  const generationId =
    /^\/(?:g|api\/generations)\/([0-9a-f-]{36})$/.exec(pathname)?.[1] ??
    /^\/api\/generations\/([0-9a-f-]{36})\/(?:events|recipe\.json)$/.exec(pathname)?.[1];

  return (
    generationId !== undefined &&
    database
      .prepare("SELECT 1 FROM generations WHERE id = ? AND is_prerendered = 1")
      .get(generationId) !== undefined
  );
}
