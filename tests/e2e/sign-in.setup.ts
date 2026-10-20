import { expect, test as setup } from "@playwright/test";

import { accessCode, storageStatePath } from "./session.ts";

// One sign-in per run, shared by every test that needs a session: logins are limited to 10 a
// minute. Tests of the anonymous flow start without this state.
setup("sign in with the run's access code", async ({ request }) => {
  const response = await request.post("/api/session", { data: { code: accessCode() } });

  expect(response.status()).toBe(204);
  await request.storageState({ path: storageStatePath() });
});
