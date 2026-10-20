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
 * The server functions anyone may call, keyed `<source file>#<export name>` (`serverFnMeta`, the
 * same in development and in a build): the picker's data, the share page's, and `/g/:id`'s, which
 * checks access itself (a pre-rendered sample's page is public, any other needs a session). Any
 * other server function needs a session (`serverFnRefusal`).
 */
export const publicServerFns = {
  "src/lib/generate.functions.ts#loadResult": true,
  "src/lib/generate.functions.ts#loadShare": true,
  "src/lib/selection.functions.ts#loadSelection": true,
} satisfies Record<string, true>;

// A share page and a stored file, as the router matches them (see `isPublicRequest`).
const sharePage = /^\/r\/[^/]+$/i;
const mediaFile = /^\/media\/([0-9a-f-]{36})\.[a-z0-9]+$/i;

/** The path as the router matches it: one trailing slash or none. */
function routePath(pathname: string) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Whether search engines may index this URL: a share page (`/r/<slug>`) or a file a share page
 * shows (`isSharedAsset`). Every other response says `X-Robots-Tag: noindex, nofollow`
 * (`src/start.ts`).
 */
export function isIndexable(pathname: string) {
  const path = routePath(pathname);
  const assetId = mediaFile.exec(path)?.[1];

  return sharePage.test(path) || (assetId !== undefined && isSharedAsset(assetId));
}

/**
 * Whether a request without a session may go on to its route: pages, media and reads anyone may
 * `GET`/`HEAD` (the picker `/`, share pages, public media, and the page and API of a pre-rendered
 * sample generation), server function calls (`/_serverFn/*`: the function middleware decides
 * once it knows which function, `serverFnRefusal`), and the two actions that may answer with a
 * result that already exists, for free: `POST /api/generate` (a pre-rendered sample × sample
 * result) and `POST /api/generations/:id/rerun` (a done generation's own result); they refuse
 * anything that would submit a job (`src/server/generate.ts`).
 *
 * The paths are matched the way the router matches them, so an alias reaches the same answer:
 * fixed parts in any letter case, and one trailing slash or none. Ids are matched as given (the
 * router passes them on unchanged); one in other letters names nothing, so it is not public.
 */
export function isPublicRequest(method: string, pathname: string) {
  if (pathname.startsWith("/_serverFn/")) {
    return true;
  }

  const path = routePath(pathname);

  if (method === "POST") {
    return /^\/api\/(?:generate|generations\/[^/]+\/rerun)$/i.test(path);
  }

  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  if (path === "/" || sharePage.test(path)) {
    return true;
  }

  const assetId = mediaFile.exec(path)?.[1];

  if (assetId !== undefined) {
    return isPublicAsset(assetId);
  }

  const generationId =
    /^\/(?:g|api\/generations)\/([0-9a-f-]{36})$/i.exec(path)?.[1] ??
    /^\/api\/generations\/([0-9a-f-]{36})\/(?:events|recipe\.json)$/i.exec(path)?.[1];

  return (
    generationId !== undefined &&
    database
      .prepare("SELECT 1 FROM generations WHERE id = ? AND is_prerendered = 1")
      .get(generationId) !== undefined
  );
}
