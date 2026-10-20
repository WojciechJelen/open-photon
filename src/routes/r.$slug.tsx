import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import {
  SharePageView,
  shareDescription,
  shareTitle,
} from "#/features/genjutsu/components/share-page";
import { loadShare } from "#/features/genjutsu/generate.functions";
import { Problem } from "#/shared/components/problem";

// The public share page of a done generation. It is open without the access code
// (`src/features/genjutsu/server/public-access.ts`), so social sites can read its Open Graph tags from the
// server-rendered HTML: every URL in them is absolute (`PUBLIC_APP_URL`, else the request's origin).
export const Route = createFileRoute("/r/$slug")({
  loader: async ({ params }) => {
    const share = await loadShare({ data: params.slug });

    if (!share) {
      throw notFound();
    }

    return share;
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Share page not found" }] };
    }

    const { final, pageUrl, poster, posterUrl, videoUrl } = loaderData;

    // Open Graph properties; one whose value is unknown is left out.
    const properties: [string, number | string | null | undefined][] = [
      ["og:title", shareTitle],
      ["og:description", shareDescription],
      ["og:type", "video.other"],
      ["og:url", pageUrl],
      ["og:image", posterUrl],
      ["og:image:width", poster?.width],
      ["og:image:height", poster?.height],
      ["og:video", videoUrl],
      ["og:video:secure_url", videoUrl.startsWith("https:") ? videoUrl : null],
      ["og:video:type", final.mime],
      ["og:video:width", final.width],
      ["og:video:height", final.height],
    ];

    return {
      meta: [
        { title: shareTitle },
        { name: "description", content: shareDescription },
        ...properties.flatMap(([property, content]) =>
          content === null || content === undefined ? [] : [{ property, content: String(content) }],
        ),
        // A player card needs an embeddable player page; the poster card needs nothing more.
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: SharePage,
  notFoundComponent: () => (
    <Problem title="Share page not found">
      <Link className="underline underline-offset-3" reloadDocument to="/genjutsu">
        Make your own
      </Link>
    </Problem>
  ),
});

function SharePage() {
  return <SharePageView share={Route.useLoaderData()} />;
}
