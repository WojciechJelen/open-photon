import type { PublicAccessDeclaration } from "./access-policy.ts";

/** Any page's header asks whether the visitor has a session (`loadSession`). */
export const sessionAccess: PublicAccessDeclaration = {
  publicServerFns: { "src/shared/session.functions.ts#loadSession": true },
};
