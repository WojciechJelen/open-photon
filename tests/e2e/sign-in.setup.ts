import { expect, test as setup } from "@playwright/test";

import { storageStatePath } from "./session.ts";

// One sign-in per run, shared by every test: `/access` allows 10 attempts a minute.
setup("sign in with the access code, if the server has one", async ({ request }) => {
  const code = process.env.APP_ACCESS_CODE;

  if (code) {
    const response = await request.post("/access", { form: { code }, maxRedirects: 0 });

    expect(response.status()).toBe(303);
  }

  await request.storageState({ path: storageStatePath() });
});
