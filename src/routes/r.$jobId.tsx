import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { JobProgress } from "#/components/job-progress";

const getShare = createServerFn({ method: "GET" })
	.validator(z.object({ id: z.union([z.literal("test"), z.uuid()]) }))
	.handler(async ({ data }) => {
		const { reconcileJob } = await import("#/server/render-job.server");
		const job = data.id === "test" ? null : await reconcileJob(data.id);
		if (data.id !== "test" && !job) return null;
		return {
			title: job?.prompt ?? "Playback test fixture",
			origin: process.env.PUBLIC_APP_URL ?? "http://localhost:3030",
			job,
		};
	});
export const Route = createFileRoute("/r/$jobId")({
	loader: async ({ params }) => {
		const result = await getShare({ data: { id: params.jobId } });
		if (!result) throw notFound();
		return result;
	},
	head: ({ loaderData, params }) => {
		const output =
			loaderData?.job?.status === "complete" ? loaderData.job.output : null;
		const video = output
			? `/media/${output.filename}`
			: params.jobId === "test"
				? "/media/x.mp4"
				: null;
		const poster = output ? `/media/${output.posterFilename}` : "/media/x.jpg";
		return {
			meta: [
				{ title: loaderData?.title ?? "Wan Animate 2 render" },
				{
					property: "og:title",
					content: loaderData?.title ?? "Wan Animate 2 render",
				},
				{
					property: "og:description",
					content: "Character animation rendered with Wan Animate 2 on Comfy.",
				},
				{ property: "og:type", content: "video.other" },
				{
					property: "og:url",
					content: `${loaderData?.origin}/r/${params.jobId}`,
				},
				{ property: "og:image", content: `${loaderData?.origin}${poster}` },
				...(video
					? [
							{
								property: "og:video",
								content: `${loaderData?.origin}${video}`,
							},
							{ property: "og:video:type", content: "video/mp4" },
						]
					: []),
			],
		};
	},
	component: Share,
});
function Share() {
	const data = Route.useLoaderData();
	return (
		<main className="mx-auto max-w-3xl space-y-6 p-8">
			<h1 className="text-3xl font-semibold">{data.title}</h1>
			{data.job ? (
				<JobProgress key={data.job.id} job={data.job} />
			) : (
				<>
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
				</>
			)}
			<Link to="/">Back to the studio</Link>
		</main>
	);
}
