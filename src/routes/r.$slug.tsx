import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";
import {
  outputsShareText,
  SharePageView,
  shareDescription,
  shareTitle,
} from "#/features/motionTransfer/components/share-page";
import { loadShare } from "#/features/motionTransfer/generate.functions";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { shownOutputs } from "#/shared/components/generated-outputs";
import { GENERATED_VIDEO_LABEL } from "#/shared/components/generated-video";
import { Problem } from "#/shared/components/problem";
import type { Asset } from "#/shared/contracts";

/** Open Graph properties of a share page; one whose value is unknown is left out. */
type OpenGraph = [string, number | string | null | undefined][];

/** A file of a share page with its absolute URL. */
type SharedFile = { asset: Asset; url: string };

/** The Open Graph properties of a share page that shows `video`: its poster is the card's image. */
function videoOpenGraph(pageUrl: string, video: SharedFile, poster: SharedFile | null): OpenGraph {
  return [
    ["og:type", "video.other"],
    ["og:url", pageUrl],
    ["og:image", poster?.url],
    ["og:image:width", poster?.asset.width],
    ["og:image:height", poster?.asset.height],
    ["og:video", video.url],
    ["og:video:secure_url", video.url.startsWith("https:") ? video.url : null],
    ["og:video:type", video.asset.mime],
    ["og:video:width", video.asset.width],
    ["og:video:height", video.asset.height],
  ];
}

// The public share page of a done generation. It is open without the access code
// (`generationAccess`, `src/shared/server/generation/public-access.ts`), so social sites can read
// its Open Graph tags from the server-rendered HTML: every URL in them is absolute
// (`PUBLIC_APP_URL`, else the request's origin). A Motion Transfer take is a video with its
// poster; any other generation is shown by its outputs (its first video with that video's
// poster, else its first image, is the card's).
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

    let title: string;
    let description: string;
    let media: OpenGraph;

    if (loaderData.view === "motionTransfer") {
      const { final, pageUrl, poster, posterUrl, videoUrl } = loaderData;

      title = shareTitle;
      description = shareDescription;
      media = videoOpenGraph(
        pageUrl,
        { asset: final, url: videoUrl },
        poster && posterUrl ? { asset: poster, url: posterUrl } : null,
      );
    } else {
      const { images, videos } = shownOutputs(loaderData.outputs);
      const [shown] = videos;
      const [image] = images;
      const text = outputsShareText(loaderData);

      title = text.title;
      description = text.description;
      media = shown
        ? [
            ...videoOpenGraph(loaderData.pageUrl, shown.video, shown.poster),
            ["og:image:alt", shown.poster ? GENERATED_VIDEO_LABEL : null],
          ]
        : [
            ["og:type", "website"],
            ["og:url", loaderData.pageUrl],
            ["og:image", image?.url],
            ["og:image:width", image?.asset.width],
            ["og:image:height", image?.asset.height],
            ["og:image:alt", image ? GENERATED_IMAGE_ALT : null],
          ];
    }

    const properties: OpenGraph = [["og:title", title], ["og:description", description], ...media];

    return {
      meta: [
        { title },
        { name: "description", content: description },
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
    <Problem text="This share page doesn't exist." title="Nothing here">
      <Button asChild variant="outline">
        <Link reloadDocument to="/motionTransfer">
          Make your own
        </Link>
      </Button>
    </Problem>
  ),
});

function SharePage() {
  return <SharePageView share={Route.useLoaderData()} />;
}
