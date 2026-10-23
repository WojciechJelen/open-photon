// The application's server composition: the one module that brings feature implementations into
// shared code (`scripts/check-import-boundaries.mjs`). A feature with public routes, assets or
// server functions adds its `PublicAccessDeclaration` here; one with data every database needs
// adds its seeder; one with a workflow the generation service runs adds its definition.
import { motionTransferAccess } from "../features/motionTransfer/server/public-access.ts";
import { seedSamples } from "../features/motionTransfer/server/samples.ts";
import { motionTransferDefinition } from "../features/motionTransfer/workflows/definition.ts";
import { studioAccess } from "../features/studio/server/public-access.ts";
import { createAccessPolicy } from "../shared/server/access-policy.ts";
import { database } from "../shared/server/db.server.ts";
import { createWorkflowRegistry } from "../shared/server/generation/definition.ts";
import { generationAccess } from "../shared/server/generation/public-access.ts";
import { transaction } from "../shared/server/migrate.ts";

/** The composed access rules (`createAccessPolicy`); anything no feature declares is private. */
export const { isIndexable, isPublicAsset, isPublicRequest, isPublicServerFn } = createAccessPolicy(
  [generationAccess, studioAccess, motionTransferAccess],
);

/**
 * The workflows the generation service runs (`src/shared/server/generation/`), found again by the
 * `(workflow_id, workflow_version)` each stored generation records.
 */
export const workflows = createWorkflowRegistry([motionTransferDefinition]);

/** Each feature's seeder: idempotent, so it runs on every start, each in its own transaction. */
const seeders = [seedSamples];

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
