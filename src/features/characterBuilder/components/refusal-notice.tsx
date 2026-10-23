import { CircleAlertIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import type { Refusal } from "#/shared/requests";

/**
 * A request the server refused (or never got), with the action that recovers from it:
 * - no answer, `rate_limited`, `queue_full`: try the same request again (`onRetry`; it carries
 *   the same request key, so a request that did arrive is not made twice);
 * - `code_exhausted`: enter another access code (`onUnlock`);
 * - `request_key_conflict`: send it as a new request (`onFresh`);
 * - anything else (`invalid_input`, a missing caption…): `children`, the page's own way back.
 */
export function RefusalNotice({
  children,
  onFresh,
  onRetry,
  onUnlock,
  refusal,
}: {
  children?: React.ReactNode;
  onFresh?: () => void;
  onRetry: () => void;
  onUnlock: () => void;
  refusal: Refusal;
}) {
  const retryable =
    refusal.reason === undefined ||
    refusal.reason === "rate_limited" ||
    refusal.reason === "queue_full";

  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/6 px-5 py-4"
      data-reason={refusal.reason ?? "none"}
      role="alert"
    >
      <p className="flex items-start gap-3">
        <CircleAlertIcon
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-destructive-foreground"
        />
        <span className="min-w-0 break-words">{refusal.message}</span>
      </p>
      <div className="flex flex-wrap gap-2.5">
        {retryable && (
          <Button onClick={onRetry} variant="outline">
            Try again
          </Button>
        )}
        {refusal.reason === "code_exhausted" && (
          <Button onClick={onUnlock} variant="outline">
            Enter another code
          </Button>
        )}
        {refusal.reason === "request_key_conflict" && onFresh && (
          <Button onClick={onFresh} variant="outline">
            Send as a new request
          </Button>
        )}
        {children}
      </div>
    </div>
  );
}
