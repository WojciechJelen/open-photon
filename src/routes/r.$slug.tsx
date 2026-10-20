import { createFileRoute, Link, notFound } from "@tanstack/react-router";

import { LoopingVideo } from "#/components/looping-video";
import { RecipePanel } from "#/components/recipe-panel";
import { Button } from "#/components/ui/button";
import { loadShare } from "#/lib/generate.functions";
import { mediaUrl } from "#/lib/media";

const title = "Genjutsu: one motion, another character";

const description =
  "The motion of one clip, performed by another character. Made with Open Photon on the Wan Animate 2 workflow.";

// The public share page of a done generation. It is open without the access code
// (`src/server/share.ts`), so social sites can read its Open Graph tags from the server-rendered
// HTML: every URL in them is absolute (`PUBLIC_APP_URL`, else the request's origin).
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
      ["og:title", title],
      ["og:description", description],
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
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Share page not found</h1>
      <Link className="text-sm underline" reloadDocument to="/">
        Make your own
      </Link>
    </main>
  ),
});

function SharePage() {
  const { final, models, poster, recipe, source } = Route.useLoaderData();
  const portrait = (final.height ?? 0) >= (final.width ?? 0);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="grid grid-cols-3 items-start gap-4">
        <figure className="col-span-2 flex flex-col gap-2">
          <LoopingVideo
            className={portrait ? "aspect-9/16 object-contain" : "aspect-video object-contain"}
            label="Result"
            poster={poster ? mediaUrl(poster) : undefined}
            src={mediaUrl(final)}
          />
          <figcaption className="text-sm">Result</figcaption>
        </figure>
        <figure className="flex flex-col gap-2">
          <LoopingVideo label="Source motion" src={mediaUrl(source)} />
          <figcaption className="text-sm">Source motion</figcaption>
        </figure>
      </div>

      <div>
        {/* A whole page load: `/` is behind the access code, which a visitor may still have to enter. */}
        <Button asChild>
          <Link reloadDocument search={{ motion: source.id }} to="/">
            Use this motion with my character
          </Link>
        </Button>
      </div>

      <RecipePanel recipe={recipe} />

      <section aria-labelledby="models-heading" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold" id="models-heading">
          Models
        </h2>
        {models ? (
          <ul className="flex flex-col gap-1 text-sm">
            {models.map(({ file, license }) => (
              <li className="break-all" key={file}>
                <code>{file}</code> · {license ?? "license not recorded yet"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">
            The workflow has changed since this video was made, so its model files are not listed.
          </p>
        )}
        {models?.some(({ license }) => license === null) && (
          <p className="text-sm text-muted-foreground">
            These are the model files the workflow loads. Their licenses and hashes are not pinned
            in this repository yet.
          </p>
        )}
      </section>
    </main>
  );
}
