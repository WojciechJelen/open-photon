import { Link } from "@tanstack/react-router";
import { GlobeIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Button } from "#/components/ui/button";
import { CopyField } from "#/shared/components/copy-field";
import { generationPublicationSchema } from "#/shared/contracts";
import { callApi, type Refusal } from "#/shared/requests";

const neverChanges = () => () => {};

/**
 * "Publish & copy link" for a done generation whose workflow publishes on request (a character
 * image), or its share link once it is published (`slug`). Publishing is the owner's explicit
 * choice after checking the image (the FLUX Kommunity licence asks for outputs to be reviewed
 * before they are distributed): `POST /api/generations/:id/publish` gives it its public share
 * page, whose link is then copied (or left to copy by hand). `compact` is the library card's
 * shape; `label` names the image to assistive technology there.
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
  // The page's origin, for a link published before this page opened (empty on the server).
  const origin = useSyncExternalStore(
    neverChanges,
    () => window.location.origin,
    () => "",
  );

  const [published, setPublished] = useState<{ copied: boolean; slug: string; url: string }>();
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const shareSlug = published?.slug ?? slug;
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

    const copied = await navigator.clipboard.writeText(url).then(
      () => true,
      () => false,
    );

    setPublished({ copied, slug: share_slug, url });
    onPublished?.(share_slug);
  }

  if (shareSlug) {
    const url = published?.url ?? `${origin}/r/${shareSlug}`;

    return (
      <div className="flex flex-col gap-2">
        <p
          aria-live="polite"
          className="flex items-center gap-2 text-sm font-semibold"
          data-share-slug={shareSlug}
          role="status"
        >
          <GlobeIcon aria-hidden="true" className="size-4 text-success" />
          {published
            ? published.copied
              ? "Published. Link copied to the clipboard."
              : "Published. Copy the link below."
            : "Published"}
        </p>
        <CopyField
          copyLabel={`Copy share link${suffix}`}
          hideLabel={compact}
          iconOnly
          label={`Share link${suffix}`}
          value={url}
        />
        {!compact && (
          <p className="text-sm text-muted-foreground">
            Anyone with the link sees this AI-generated image.{" "}
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
