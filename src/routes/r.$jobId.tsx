import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const getShare = createServerFn({ method: "GET" })
	.validator(z.object({ id: z.union([z.literal("test"), z.uuid()]) }))
	.handler(async ({ data }) => {
		const { findJob } = await import("#/server/db.server");
		const job = data.id === "test" ? null : findJob(data.id);
		if (data.id !== "test" && !job) return null;
		return {
			title: job?.prompt ?? "A slow orbit around a ceramic vase",
			origin: process.env.PUBLIC_APP_URL ?? "http://localhost:3030",
		};
	});
export const Route = createFileRoute("/r/$jobId")({
	loader: async ({ params }) => {
		const result = await getShare({ data: { id: params.jobId } });
		if (!result) throw notFound();
		return result;
	},
	head: ({ loaderData, params }) => ({
		meta: [
			{ title: loaderData?.title ?? "Comfy render" },
			{ property: "og:title", content: loaderData?.title ?? "Comfy render" },
			{
				property: "og:description",
				content: "A shareable video from the Comfy video app spike.",
			},
			{ property: "og:type", content: "video.other" },
			{
				property: "og:url",
				content: `${loaderData?.origin}/r/${params.jobId}`,
			},
			{ property: "og:image", content: `${loaderData?.origin}/media/x.jpg` },
			{ property: "og:video", content: `${loaderData?.origin}/media/x.mp4` },
			{ property: "og:video:type", content: "video/mp4" },
		],
	}),
	component: Share,
});
function Share() {
	const data = Route.useLoaderData();
	return (
		<main className="mx-auto max-w-3xl space-y-6 p-8">
			<h1 className="text-3xl font-semibold">{data.title}</h1>
			<p>Sample video for playback and sharing checks.</p>
			<video
				controls
				preload="metadata"
				poster="/media/x.jpg"
				className="w-full rounded-xl"
			>
				<source src="/media/x.mp4" type="video/mp4" />
				<track kind="captions" />
			</video>
			<Link to="/">Back to the studio</Link>
		</main>
	);
}
