import type { PublicAccessDeclaration } from "../../../shared/server/access-policy.ts";

/** The studio home `/` is open without the access code; its data is Motion Transfer's `loadStudio`. */
export const studioAccess: PublicAccessDeclaration = {
  publicRoutes: [
    { method: "GET", pattern: /^\/$/ },
    { method: "GET", pattern: /^\/setup\.md$/i },
  ],
};
