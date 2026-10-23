import type { PublicAccessDeclaration } from "../../../shared/server/access-policy.ts";

/**
 * The builder's page `/characters/new` needs the access code, and so does every request it
 * makes; only whether the visitor has a session (`loadBuilderAccess`) is public, so a visitor who
 * reaches the page by an in-app link sees that it needs the code.
 */
export const characterBuilderAccess: PublicAccessDeclaration = {
  publicServerFns: {
    "src/features/characterBuilder/access.functions.ts#loadBuilderAccess": true,
  },
};
