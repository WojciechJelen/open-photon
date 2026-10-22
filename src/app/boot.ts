import { seedDatabase } from "./server.ts";

/**
 * A Nitro plugin (registered in `vite.config.ts`, after `comfy-boot.ts`): it opens, migrates and
 * seeds the database once as the server starts, before it listens, so the first request finds
 * the samples; a failing migration (`migrate.ts`) stops the process here.
 */
export default function seedAtBoot() {
  seedDatabase();
}
