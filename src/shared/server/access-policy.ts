import { findAsset, type StoredAsset } from "./assets.ts";

/**
 * A route a request without a session may reach: `method` (`GET` also allows `HEAD`) and
 * `pattern`, matched against the path as the router matches it (one trailing slash or none; give
 * fixed parts the `i` flag, since the router ignores their letter case). `when`, given the
 * pattern's match, can narrow it further (a pre-rendered sample's page, say).
 */
export type PublicRoute = {
  method: "GET" | "POST";
  pattern: RegExp;
  when?: (match: RegExpExecArray) => boolean;
};

/**
 * What one feature makes public; everything else needs a session (the access code). Features
 * export one each; `src/app/server.ts` composes them (`createAccessPolicy`).
 */
export type PublicAccessDeclaration = {
  /**
   * The server functions anyone may call, keyed `<source file>#<export name>` (`serverFnMeta`,
   * the same in development and in a build). Moving a `*.functions.ts` file changes its keys.
   */
  publicServerFns?: Readonly<Record<string, true>>;
  /** Pages, reads and actions anyone may request (`PublicRoute`). */
  publicRoutes?: readonly PublicRoute[];
  /** Whether anyone may load this stored asset at `/media/<id>.<ext>`. */
  isPublicAsset?: (asset: StoredAsset) => boolean;
  /** Paths search engines may index, matched like `publicRoutes`' patterns. */
  indexableRoutes?: readonly RegExp[];
  /** Whether search engines may index this stored asset at `/media/<id>.<ext>`. */
  isIndexableAsset?: (asset: StoredAsset) => boolean;
};

// A stored file, as `src/routes/media.$filename.ts` serves it.
const mediaFile = /^\/media\/([0-9a-f-]{36})\.[a-z0-9]+$/i;

/** The path as the router matches it: one trailing slash or none. */
function routePath(pathname: string) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * The access rules of the features `declarations` describe, private by default:
 * - `isPublicRequest(method, pathname)`: whether a request without a session may go on to its
 *   route. Server function calls (`/_serverFn/*`) always may: the function middleware decides
 *   once it knows which function (`isPublicServerFn`). `/media/<id>.<ext>` may when a feature
 *   declares the asset public. Any other path only when a declared `PublicRoute` matches it; a
 *   method other than `GET`/`HEAD`/`POST` never.
 * - `isPublicAsset(assetId)`: whether some feature declares the stored asset public.
 * - `isPublicServerFn(id)`: whether `<source file>#<export name>` is declared public.
 * - `isIndexable(pathname)`: whether search engines may index the URL (`src/start.ts` marks every
 *   other response `noindex`).
 *
 * The paths are matched the way the router matches them, so an alias reaches the same answer.
 * Ids are matched as given (the router passes them on unchanged); one in other letters names
 * nothing, so it is not public.
 */
export function createAccessPolicy(declarations: readonly PublicAccessDeclaration[]) {
  const publicServerFns = new Set(
    declarations.flatMap((declaration) => Object.keys(declaration.publicServerFns ?? {})),
  );

  const publicRoutes = declarations.flatMap((declaration) => declaration.publicRoutes ?? []);
  const indexableRoutes = declarations.flatMap((declaration) => declaration.indexableRoutes ?? []);

  const isPublicAsset = (assetId: string) => {
    const asset = findAsset(assetId);

    return asset !== null && declarations.some((declaration) => declaration.isPublicAsset?.(asset));
  };

  return {
    isIndexable: (pathname: string) => {
      const path = routePath(pathname);
      const assetId = mediaFile.exec(path)?.[1];

      if (assetId === undefined) {
        return indexableRoutes.some((pattern) => pattern.test(path));
      }

      const asset = findAsset(assetId);

      return (
        asset !== null && declarations.some((declaration) => declaration.isIndexableAsset?.(asset))
      );
    },
    isPublicAsset,
    isPublicRequest: (method: string, pathname: string) => {
      if (pathname.startsWith("/_serverFn/")) {
        return true;
      }

      const path = routePath(pathname);
      const read = method === "GET" || method === "HEAD";

      if (!read && method !== "POST") {
        return false;
      }

      const assetId = mediaFile.exec(path)?.[1];

      if (read && assetId !== undefined) {
        return isPublicAsset(assetId);
      }

      return publicRoutes.some((route) => {
        const match = (route.method === "GET") === read ? route.pattern.exec(path) : null;

        return match !== null && (route.when?.(match) ?? true);
      });
    },
    isPublicServerFn: (id: string) => publicServerFns.has(id),
  };
}
