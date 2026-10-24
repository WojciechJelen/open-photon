import type { PublicAccessDeclaration } from "../../../shared/server/access-policy.ts";

/**
 * What the presets feature opens without the access code (`createAccessPolicy`, composed in
 * `src/app/server.ts`), like the Motion Transfer wizard it prefills:
 * - the gallery `/presets` and each preset's page `/presets/:presetId`, and their data;
 * - `POST /api/presets/:presetId/generations`, which, like `POST /api/generate`, answers without
 *   a session only with a pre-rendered sample take that already exists, and asks for the code
 *   before anything would be submitted.
 * The previews are bundled files, not stored assets.
 */
export const presetsAccess: PublicAccessDeclaration = {
  publicRoutes: [
    { method: "GET", pattern: /^\/presets$/i },
    { method: "GET", pattern: /^\/presets\/[a-z0-9-]+$/i },
    { method: "POST", pattern: /^\/api\/presets\/[a-z0-9-]+\/generations$/i },
  ],
  publicServerFns: {
    "src/features/presets/presets.functions.ts#loadPreset": true,
    "src/features/presets/presets.functions.ts#loadPresets": true,
  },
};
