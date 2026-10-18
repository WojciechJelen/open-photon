import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Output } from "@comfyorg/sdk";
import { z } from "zod";
import { videoOutputSchema } from "../lib/contracts.ts";
import { mediaDirectory } from "./media.server.ts";

const execute = promisify(execFile);
const probeSchema = z.object({
	streams: z.array(
		z.object({
			codec_type: z.string().optional(),
			width: z.number().optional(),
			height: z.number().optional(),
		}),
	),
	format: z.object({ duration: z.coerce.number().positive() }),
});
export async function saveVideoOutput(
	id: string,
	output: Output,
	signal?: AbortSignal,
) {
	const directory = mediaDirectory();
	await mkdir(directory, { recursive: true });
	const filename = `${id}.mp4`,
		posterFilename = `${id}.jpg`;
	const temporary = resolve(directory, `${id}.${randomUUID()}.part.mp4`);
	const posterTemporary = `${temporary}.jpg`;
	try {
		await output.toFile(temporary, { signal, timeoutMs: 180000 });
		const info = await stat(temporary);
		if (
			info.size === 0 ||
			(output.sizeBytes > 0 && output.sizeBytes !== info.size)
		)
			throw new Error(
				"Downloaded video size does not match the provider output",
			);
		const probe = await execute(
			"ffprobe",
			[
				"-v",
				"error",
				"-show_entries",
				"format=duration:stream=codec_type,width,height",
				"-of",
				"json",
				temporary,
			],
			{ signal, timeout: 15000, maxBuffer: 65536 },
		);
		const metadata = probeSchema.parse(JSON.parse(probe.stdout));
		const video = metadata.streams.find(
			(stream) => stream.codec_type === "video",
		);
		if (!video?.width || !video.height)
			throw new Error("The output has no decodable video stream");
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(temporary, { signal }))
			hash.update(chunk);
		await execute(
			"ffmpeg",
			[
				"-v",
				"error",
				"-y",
				"-i",
				temporary,
				"-frames:v",
				"1",
				"-vf",
				"scale=640:-2",
				posterTemporary,
			],
			{ signal, timeout: 30000, maxBuffer: 65536 },
		);
		signal?.throwIfAborted();
		await rename(posterTemporary, resolve(directory, posterFilename));
		await rename(temporary, resolve(directory, filename));
		return videoOutputSchema.parse({
			filename,
			posterFilename,
			bytes: info.size,
			width: video.width,
			height: video.height,
			durationSeconds: metadata.format.duration,
			sha256: hash.digest("hex"),
			assetId: output.id,
		});
	} finally {
		await rm(temporary, { force: true });
		await rm(posterTemporary, { force: true });
	}
}
