import { z } from "zod";

import type { GenerationReceipt } from "../../contracts.ts";
import { readJsonBody, readSession, type Session } from "../access.server.ts";
import { comfyProvider, type Provider } from "../comfy-provider.ts";
import { requesterKeys, returnToken, takeToken } from "../limits.ts";
import { GenerateError } from "./errors.ts";
import type { Admit } from "./service.ts";

/**
 * The answer to a request that starts a generation: 201 with its receipt for a submitted one,
 * 202 with `status: "waiting"` and its `position` for one admitted in line while every place in
 * flight is taken, 200 with `reused: true` for an existing one returned instead, or the
 * `GenerateError`'s status with `{ error, reason?, retry_after? }` (and `Retry-After`).
 *
 * Every answer but an existing result takes a token from the request's client and access code
 * (`takeToken`, `GENERATE_RATE_LIMIT` a minute): a new row before it is created (`admit`), a
 * refusal (a malformed body, a missing clip, no code…) as it is answered. Without a token the
 * answer is a 429 `rate_limited` instead, and no row is created; an existing result stays free,
 * even one found only after `admit` (another request made it while the full cap was refreshed):
 * its token is given back. A request repeated with its `request_key` gets its generation back
 * without a token.
 */
export async function answer(
  request: Request,
  start: (session: Session | null, admit: Admit) => Promise<GenerationReceipt>,
) {
  const session = readSession(request);
  let charged = false;

  const charge = () => {
    charged = true;
    const wait = takeToken("generate", requesterKeys(request, session), Date.now());

    return wait === undefined
      ? undefined
      : new GenerateError(
          429,
          `Too many generation requests. Try again in ${wait} s.`,
          "rate_limited",
          wait,
        );
  };

  try {
    const result = await start(session, () => {
      const limited = charge();

      if (limited) {
        throw limited;
      }
    });

    if (charged && result.reused) {
      returnToken("generate", requesterKeys(request, session));
    }

    return Response.json(result, {
      status: result.reused ? 200 : result.status === "waiting" ? 202 : 201,
    });
  } catch (error) {
    if (!(error instanceof GenerateError)) {
      throw error;
    }

    const refused = (charged ? undefined : charge()) ?? error;

    return Response.json(
      { error: refused.message, reason: refused.reason, retry_after: refused.retryAfter },
      {
        headers:
          refused.retryAfter === undefined ? {} : { "Retry-After": String(refused.retryAfter) },
        status: refused.status,
      },
    );
  }
}

// The optional client key of a request body (`request_key`, a UUID): the same key again returns
// the generation the first request made (`submit`).
const requestKeySchema = z.object({ request_key: z.uuid().optional() });

/**
 * A request's JSON body (at most `limit` bytes) as `schema`, a workflow's input, and its optional
 * `request_key`; a 400 `invalid_input` for a body that is too large, not JSON, not the schema, or
 * with a `request_key` that is not a UUID.
 */
export async function readInput<Input>(request: Request, schema: z.ZodType<Input>, limit: number) {
  const body = await readJsonBody(request, z.json(), limit);

  if (body.error !== undefined) {
    throw new GenerateError(400, body.error, "invalid_input");
  }

  const input = schema.safeParse(body.data);

  if (!input.success) {
    throw new GenerateError(400, z.prettifyError(input.error), "invalid_input");
  }

  const key = requestKeySchema.safeParse(body.data);

  if (!key.success) {
    throw new GenerateError(400, z.prettifyError(key.error), "invalid_input");
  }

  return { input: input.data, requestKey: key.data.request_key };
}

/**
 * `POST /api/generations/:id/retry` and `…/rerun`: `start` (`retry` or `rerun`) for the request's
 * session, answered by `answer`; 400 for a malformed id.
 */
export function startChild(
  request: Request,
  value: string,
  start: (
    id: string,
    session: Session | null,
    provider: Provider,
    admit: Admit,
  ) => Promise<GenerationReceipt>,
  provider: Provider = comfyProvider,
) {
  return answer(request, (session, admit) => {
    const id = z.uuid().safeParse(value);

    if (!id.success) {
      throw new GenerateError(400, "Invalid generation ID");
    }

    return start(id.data, session, provider, admit);
  });
}

/** A route's `:generationId` as a UUID, or the 400 response for a malformed one. */
export function generationIdParam(value: string) {
  const id = z.uuid().safeParse(value);

  return id.success ? id.data : Response.json({ error: "Invalid generation ID" }, { status: 400 });
}
