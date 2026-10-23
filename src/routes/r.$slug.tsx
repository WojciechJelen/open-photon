import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import {
  outputsShareDescription,
  outputsShareTitle,
  SharePageView,
  shareDescription,
  shareTitle,
} from "#/features/motionTransfer/components/share-page";
import { loadShare } from "#/features/motionTransfer/generate.functions";
import { GENERATED_IMAGE_ALT } from "#/shared/components/generated-image";
import { Problem } from "#/shared/components/problem";

/** Open Graph properties of a share page; one whose value is unknown is left out. */
type OpenGraph = [string, number | string | null | undefined][];

// The public share page of a done generation. It is open without the access code
// (`generationAccess`, `src/shared/server/generation/public-access.ts`), so social sites can read
// its Open Graph tags from the server-rendered HTML: every URL in them is absolute
// (`PUBLIC_APP_URL`, else the request's origin). A Motion Transfer take is a video with its
// poster; any other generation is shown by its outputs (an image is the card's image).
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

    let title = outputsShareTitle;
    let description = outputsShareDescription;
    let media: OpenGraph;

    if (loaderData.view === "motionTransfer") {
      const { final, pageUrl, poster, posterUrl, videoUrl } = loaderData;

      title = shareTitle;
      description = shareDescription;
      media = [
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
    } else {
      const image = loaderData.outputs.find((output) => output.media === "image");

      media = [
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
    <Problem title="Share page not found">
      <Link className="underline underline-offset-3" reloadDocument to="/motionTransfer">
        Make your own
      </Link>
    </Problem>
  ),
});

function SharePage() {
  return <SharePageView share={Route.useLoaderData()} />;
}
