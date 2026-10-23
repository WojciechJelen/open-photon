import { expect, test as setup } from "@playwright/test";
import { z } from "zod";

import { accessCode, storageStatePath } from "./session.ts";

// One sign-in per run and server, shared by every test that needs a session: the project's
// `metadata.databasePath` names the server's database (`playwright.config.ts`; the dead-port
// server's without it). Tests of the anonymous flow start without this state.
setup("sign in with the run's access code", async ({ request }) => {
  const { databasePath } = z
    .object({ databasePath: z.string().optional() })
    .parse(setup.info().project.metadata);

  const response = await request.post("/api/session", { data: { code: accessCode(databasePath) } });

  expect(response.status()).toBe(204);
  await request.storageState({ path: storageStatePath(databasePath) });
});
