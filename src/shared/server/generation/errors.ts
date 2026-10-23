/**
 * A request that cannot become a generation: `status` is the HTTP status that says why, `reason`
 * a code the UI acts on (`access_required` asks for the access code), `retryAfter` the seconds to
 * wait before asking again (`rate_limited`, `queue_full`).
 */
export class GenerateError extends Error {
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503;
  reason: string | undefined;
  retryAfter: number | undefined;
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
    message: string,
    reason?: string,
    retryAfter?: number,
  ) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.retryAfter = retryAfter;
  }
}
