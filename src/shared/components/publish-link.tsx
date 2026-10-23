import { Link } from "@tanstack/react-router";
import { GlobeIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import { CopyField } from "#/shared/components/copy-field";
import { generationPublicationSchema, shareOriginSchema } from "#/shared/contracts";
import { callApi, type Refusal } from "#/shared/requests";

// The server's share origin (`GET /api/share-origin`), read once per page however many links it
// shows; dropped after a failed read, so the next link asks again.
let shareOrigin: Promise<string | null> | undefined;

/**
 * The origin the server starts share links with (`PUBLIC_APP_URL`, else the request's), for a
 * generation published before the page opened; `null` until it is read, or when it cannot be.
 */
function useShareOrigin(needed: boolean) {
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    if (!needed) {
      return;
    }

    let stopped = false;

    shareOrigin ??= callApi(shareOriginSchema, "/api/share-origin", { method: "GET" }).then(
      (answer) => ("data" in answer ? answer.data.origin : null),
    );

    void shareOrigin.then((value) => {
      if (value === null) {
        shareOrigin = undefined;
      }

      if (!stopped) {
        setOrigin(value);
      }
    });

    return () => {
      stopped = true;
    };
  }, [needed]);

  return origin;
}

/** What became of copying the link of a generation published here. */
type Copy = "copying" | "copied" | "failed";

/**
 * "Publish & copy link" for a done generation whose workflow publishes on request (a character
 * image), or its share link once it is published (`slug`). Publishing is the owner's explicit
 * choice after checking the image (the FLUX Kommunity licence asks for outputs to be reviewed
 * before they are distributed): `POST /api/generations/:id/publish` gives it its public share
 * page, whose link (the server's, `url`) is then copied, or left in the field to copy by hand when
 * the browser does not allow it. A link published before the page opened starts with the
 * server's share origin too. `compact` is the library card's shape; `label` names the image to
 * assistive technology there.
 */
export function PublishLink({
  compact = false,
  generationId,
  label,
  onPublished,
  slug,
}: {
  compact?: boolean;
  generationId: string;
  label?: string;
  onPublished?: (slug: string) => void;
  slug: string | null;
}) {
  const [published, setPublished] = useState<{ copy: Copy; slug: string; url: string }>();
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const shareSlug = published?.slug ?? slug;
  const origin = useShareOrigin(shareSlug !== null && published === undefined);
  const suffix = label ? `: ${label}` : "";

  async function publish() {
    setPending(true);
    setRefusal(null);

    const answer = await callApi(
      generationPublicationSchema,
      `/api/generations/${generationId}/publish`,
      { method: "POST" },
    );

    setPending(false);

    if ("refusal" in answer) {
      setRefusal(answer.refusal);

      return;
    }

    const { share_slug, url } = answer.data;

    // Published whatever the clipboard does next.
    setPublished({ copy: "copying", slug: share_slug, url });
    onPublished?.(share_slug);

    let copy: Copy = "copied";

    try {
      // Missing outside a secure context, refused without permission.
      await navigator.clipboard.writeText(url);
    } catch {
      copy = "failed";
    }

    setPublished({ copy, slug: share_slug, url });
  }

  if (shareSlug) {
    const url = published?.url ?? (origin === null ? null : `${origin}/r/${shareSlug}`);

    return (
      <div className="flex flex-col gap-2">
        <p
          aria-live="polite"
          className="flex items-center gap-2 text-sm font-semibold"
          data-share-slug={shareSlug}
          role="status"
        >
          <GlobeIcon aria-hidden="true" className="size-4 text-success" />
          {published?.copy === "copied"
            ? "Published. Link copied to the clipboard."
            : published?.copy === "failed"
              ? "Published. Copying is not allowed here; copy the link below."
              : "Published"}
        </p>
        {url && (
          <CopyField
            copyLabel={`Copy share link${suffix}`}
            hideLabel={compact}
            iconOnly
            label={`Share link${suffix}`}
            value={url}
          />
        )}
        {(!compact || !url) && (
          <p className="text-sm text-muted-foreground">
            {!compact && "Anyone with the link sees this AI-generated image. "}
            <Link
              className="text-soft-foreground underline decoration-edge-strong underline-offset-3 hover:text-foreground hover:decoration-brand"
              params={{ slug: shareSlug }}
              to="/r/$slug"
            >
              Open share page
            </Link>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className={compact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
        Publishing makes this AI-generated image public at a share link; check it first.
      </p>
      <div>
        <Button
          aria-label={`Publish & copy link${suffix}`}
          disabled={pending}
          onClick={() => void publish()}
          size={compact ? "sm" : "default"}
          variant="outline"
        >
          <GlobeIcon aria-hidden="true" />
          {pending ? "Publishing…" : "Publish & copy link"}
        </Button>
      </div>
      {refusal && (
        <p className="text-sm text-destructive-foreground" role="alert">
          {refusal.message}
        </p>
      )}
    </div>
  );
}
