import { DatabaseSync } from "node:sqlite";

import type { Page } from "@playwright/test";

/** Signs the page's browser context in when the server has an access code. */
export async function signIn(page: Page) {
  const code = process.env.APP_ACCESS_CODE;

  if (code) {
    await page.request.post("/access", { form: { code }, maxRedirects: 0 });
  }
}

/** Opens `path` and waits until React has hydrated it (`__root.tsx`), so clicks take effect. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.locator("html[data-hydrated]").waitFor();
}

/** Counts rows in the e2e server's database (`playwright.config.ts`), read-only. */
export function count(sql: string) {
  const database = new DatabaseSync(process.env.E2E_DATABASE_PATH ?? "", { readOnly: true });

  try {
    return Number(database.prepare(`SELECT count(*) AS count FROM ${sql}`).get()?.count);
  } finally {
    database.close();
  }
}
