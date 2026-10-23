// What the batches server tests share: the fake provider on a dead self-hosted port (nothing can
// reach a real Comfy), the seeded sample motion and characters a shot is made of, and a session
// as the access guard signs one in. Import `tests/temp-database.ts` before this module.
import { z } from "zod";

import { mintCode } from "../../../../tests/temp-database.ts";
import { findAccessCode } from "../../../shared/server/access-codes.ts";
import { createAccessGuard } from "../../../shared/server/access.server.ts";
import { database } from "../../../shared/server/db.server.ts";
import { workflows } from "../../../shared/server/generation/definition.ts";

Object.assign(process.env, {
  COMFY_API_KEY: "",
  COMFY_BASE_URL: "http://127.0.0.1:1",
  COMFY_FAKE_STEP_MS: "0",
  COMFY_PROVIDER: "fake",
  COMFY_PROXY_TOKEN: "",
  GENERATE_RATE_LIMIT: "1000",
  GENERATION_DISPATCH_MS: "20",
  IN_FLIGHT_MAX: "1",
});

/** Motion Transfer as the app composes it (`src/app/server.ts`, loaded by the temp database). */
export const motionTransfer = (() => {
  const definition = workflows.find({ workflow_id: "motion-transfer", workflow_version: 1 });

  if (!definition) {
    throw new Error("Motion Transfer v1 is not composed");
  }

  return definition;
})();

/** The seeded sample motion's clip: what a shot's `motion` names. */
export const motion = z
  .object({ id: z.uuid() })
  .parse(database.prepare("SELECT source_asset_id AS id FROM motions LIMIT 1").get()).id;

/** The seeded sample characters, by slug. */
export const characters = z
  .array(z.object({ id: z.uuid() }))
  .parse(database.prepare("SELECT id FROM characters WHERE is_sample = 1 ORDER BY slug").all())
  .map(({ id }) => id);

/** A new access code for `max` generations, and its session. */
export function newSession(max: number) {
  const code = mintCode(max);
  const codeId = findAccessCode(code)?.id ?? "";

  return { code, session: { codeId }, used: () => findAccessCode(code)?.used ?? 0 };
}

/** The `Cookie` header of a session signed in with `code`, as the access guard sets it. */
export async function signIn(code: string) {
  const login = await createAccessGuard({ production: false })(
    new Request("http://localhost/api/session", {
      body: JSON.stringify({ code }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

  return login?.headers.get("Set-Cookie")?.split(";")[0] ?? "";
}

/** How many generations and batches are stored. */
export function counts() {
  return z
    .object({ batches: z.int(), generations: z.int() })
    .parse(
      database
        .prepare(
          "SELECT (SELECT count(*) FROM batches) AS batches, (SELECT count(*) FROM generations) AS generations",
        )
        .get(),
    );
}
