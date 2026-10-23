import type { PublicAccessDeclaration } from "../../../shared/server/access-policy.ts";

// The gallery and an example's page, as the router matches them.
const explorePages = /^\/explore(?:\/[^/]+)?$/i;

/**
 * What Explore opens without the access code (composed in `src/app/server.ts`): the gallery
 * `/explore`, each example's page `/explore/:slug` and the server functions that read them, for
 * search engines too. It opens no file: what the pages show is public already (a shared take's
 * result and poster, `generationAccess`; a sample motion's clip, `motionTransferAccess`; a sample
 * character's image, `charactersAccess`), and nothing else is read.
 */
export const exploreAccess: PublicAccessDeclaration = {
  indexableRoutes: [explorePages],
  publicRoutes: [{ method: "GET", pattern: explorePages }],
  publicServerFns: {
    "src/features/explore/explore.functions.ts#loadExample": true,
    "src/features/explore/explore.functions.ts#loadExplore": true,
  },
};
