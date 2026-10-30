// The application's server composition: the one module that brings feature implementations into
// shared code (`scripts/check-import-boundaries.mjs`). A feature with public routes, assets or
// server functions adds its `PublicAccessDeclaration` here; one with data every database needs
// adds its seeder; one with a workflow the generation service runs adds its definition.
import { angleViewDefinition } from "../features/angles/workflows/definition.ts";
import { animateImageDefinition } from "../features/animateImage/workflows/definition.ts";
import { characterCaptionDefinition } from "../features/characterBuilder/workflows/caption-definition.ts";
import { characterGenerationDefinition } from "../features/characterBuilder/workflows/definition.ts";
import { charactersAccess } from "../features/characters/server/public-access.ts";
import { seedSampleCharacters } from "../features/characters/server/seed.ts";
import { exploreAccess } from "../features/explore/server/public-access.ts";
import {
  imageEditDefinition,
  imageEditEnhancedDefinition,
} from "../features/imageEdit/workflows/definition.ts";
import { motionTransferAccess } from "../features/motionTransfer/server/public-access.ts";
import { seedSampleMotions } from "../features/motionTransfer/server/samples.ts";
import { motionTransferDefinition } from "../features/motionTransfer/workflows/definition.ts";
import { presetsAccess } from "../features/presets/server/public-access.ts";
import { productShotDefinition } from "../features/productStudio/workflows/definition.ts";
import { spriteSheetDefinition } from "../features/spriteForge/workflows/sheet-definition.ts";
import { spriteViewDefinition } from "../features/spriteForge/workflows/view-definition.ts";
import { storyboardScenesDefinition } from "../features/storyboard/workflows/scenes-definition.ts";
import { studioAccess } from "../features/studio/server/public-access.ts";
import { createAccessPolicy } from "../shared/server/access-policy.ts";
import { database } from "../shared/server/db.server.ts";
import { workflows } from "../shared/server/generation/definition.ts";
import { generationAccess } from "../shared/server/generation/public-access.ts";
import { transaction } from "../shared/server/migrate.ts";
import { sessionAccess } from "../shared/server/public-access.ts";

/** The composed access rules (`createAccessPolicy`); anything no feature declares is private. */
export const { isIndexable, isPublicAsset, isPublicRequest, isPublicServerFn } = createAccessPolicy(
  [
    sessionAccess,
    generationAccess,
    studioAccess,
    charactersAccess,
    motionTransferAccess,
    presetsAccess,
    exploreAccess,
  ],
);

// The workflows the generation service runs (`workflows`, `src/shared/server/generation/`), found
// again by the `(workflow_id, workflow_version)` each stored generation records.
workflows.compose([
  motionTransferDefinition,
  characterGenerationDefinition,
  characterCaptionDefinition,
  imageEditDefinition,
  imageEditEnhancedDefinition,
  animateImageDefinition,
  angleViewDefinition,
  storyboardScenesDefinition,
  productShotDefinition,
  spriteViewDefinition,
  spriteSheetDefinition,
]);

/** Each feature's seeder: idempotent, so it runs on every start, each in its own transaction. */
const seeders = [seedSampleCharacters, seedSampleMotions];

/**
 * Seeds the database: the sample characters and motions. Runs at boot before the server listens
 * (`src/app/boot.ts`), and explicitly wherever a database is prepared without the server
 * (`scripts/seed-samples.mjs`, `tests/temp-database.ts`, `tests/e2e/seed.ts`). Running it again
 * changes nothing.
 */
export function seedDatabase() {
  for (const seed of seeders) {
    transaction(database, () => seed(database));
  }
}
