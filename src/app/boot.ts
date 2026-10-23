import type { NitroApp } from "nitro/types";

import {
  type Dispatcher,
  recoverAfterRestart,
  startDispatcher,
} from "../shared/server/generation/dispatcher.ts";
import { seedDatabase } from "./server.ts";

declare global {
  // The process's dispatcher, which a dev server running this plugin again stops first.
  var openPhotonDispatcher: Dispatcher | undefined;
}

/**
 * A Nitro plugin (registered in `vite.config.ts`, after `comfy-boot.ts`): it opens, migrates and
 * seeds the database once as the server starts, before it listens, so the first request finds
 * the samples; a failing migration (`migrate.ts`) stops the process here. Then it settles what a
 * stopped server left (`recoverAfterRestart`) and starts the process's one generation dispatcher
 * (`dispatcher.ts`), which the server's `close` hook stops. A dev server that runs the plugin
 * again stops the dispatcher it started before.
 */
export default function startAtBoot(nitroApp: NitroApp) {
  seedDatabase();

  void globalThis.openPhotonDispatcher?.stop();
  recoverAfterRestart();

  const dispatcher = startDispatcher();

  globalThis.openPhotonDispatcher = dispatcher;
  nitroApp.hooks?.hook("close", () => dispatcher.stop());
}
