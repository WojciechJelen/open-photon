import type { PublicAccessDeclaration } from "../access-policy.ts";
import { database } from "../db.server.ts";
import { isSharedOutput } from "./generations.ts";

/** Whether a generation is a pre-rendered sample, whose page and API anyone may read. */
function isPrerendered(match: RegExpExecArray) {
  return (
    database
      .prepare("SELECT 1 FROM generations WHERE id = ? AND is_prerendered = 1")
      .get(match[1] ?? "") !== undefined
  );
}

// A share page, as the router matches it.
const sharePage = /^\/r\/[^/]+$/i;

/**
 * What every generation opens without the access code, whatever its workflow (composed in
 * `src/app/server.ts`):
 * - share pages `/r/:slug`, and the files a done generation with a share page lists among its
 *   outputs (`isSharedOutput`); for search engines too;
 * - the page and API of a pre-rendered sample generation (`/g/:id`, `/api/generations/:id`, its
 *   events and recipe);
 * - `POST /api/generations/:id/rerun`, which may answer with a done generation's own result for
 *   free and refuses anything that would submit a job (`rerun`).
 *
 * A feature adds the other files its share pages show (Motion Transfer: the source clip).
 */
export const generationAccess: PublicAccessDeclaration = {
  indexableRoutes: [sharePage],
  isIndexableAsset: isSharedOutput,
  isPublicAsset: isSharedOutput,
  publicRoutes: [
    { method: "POST", pattern: /^\/api\/generations\/[^/]+\/rerun$/i },
    { method: "GET", pattern: sharePage },
    { method: "GET", pattern: /^\/(?:g|api\/generations)\/([0-9a-f-]{36})$/i, when: isPrerendered },
    {
      method: "GET",
      pattern: /^\/api\/generations\/([0-9a-f-]{36})\/(?:events|recipe\.json)$/i,
      when: isPrerendered,
    },
  ],
};
