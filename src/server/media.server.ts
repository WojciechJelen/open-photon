import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export function mediaDirectory() {
	return resolve(
		process.env.MEDIA_DIRECTORY ??
			resolve(
				dirname(process.env.DATABASE_PATH ?? "data/spike.sqlite"),
				"media",
			),
	);
}

export function byteRange(header: string, size: number) {
	const match = /^bytes=(\d*)-(\d*)$/.exec(header);
	if (!match || (!match[1] && !match[2]) || size === 0) return null;
	const first = match[1] ? Number(match[1]) : undefined;
	const last = match[2] ? Number(match[2]) : undefined;
	if (
		(first !== undefined && !Number.isSafeInteger(first)) ||
		(last !== undefined && !Number.isSafeInteger(last))
	)
		return null;
	const start = first ?? Math.max(0, size - (last ?? 0));
	const end =
		first === undefined ? size - 1 : Math.min(last ?? size - 1, size - 1);
	return start >= size || start > end ? null : { start, end };
}

export async function serveMedia(request: Request, filename: string) {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(mp4|jpg)$/.test(filename))
		return new Response("Invalid filename", { status: 400 });
	const path = ["x.mp4", "x.jpg"].includes(filename)
		? resolve("fixtures", filename)
		: resolve(mediaDirectory(), filename);
	const info = await stat(path).catch(() => null);
	if (!info?.isFile()) return new Response("Media not found", { status: 404 });
	const headers = new Headers({
		"Content-Type": filename.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
		"Accept-Ranges": "bytes",
		"Content-Length": String(info.size),
		"Last-Modified": info.mtime.toUTCString(),
		"Cache-Control": "public, max-age=3600",
	});
	const rangeHeader = request.headers.get("range");
	const ifRange = request.headers.get("if-range");
	const honorRange =
		rangeHeader && (!ifRange || ifRange === info.mtime.toUTCString());
	const range = honorRange ? byteRange(rangeHeader, info.size) : undefined;
	if (range === null) {
		headers.set("Content-Range", `bytes */${info.size}`);
		headers.set("Content-Length", "0");
		return new Response(null, { status: 416, headers });
	}
	if (range) {
		headers.set(
			"Content-Range",
			`bytes ${range.start}-${range.end}/${info.size}`,
		);
		headers.set("Content-Length", String(range.end - range.start + 1));
	}
	const file =
		request.method === "HEAD"
			? null
			: createReadStream(
					path,
					range
						? { ...range, signal: request.signal }
						: { signal: request.signal },
				);
	const iterator = file?.[Symbol.asyncIterator]();
	let stopped = false;
	const body = iterator
		? new ReadableStream<Uint8Array>({
				async pull(controller) {
					try {
						const chunk = await iterator.next();
						if (stopped) return;
						if (chunk.done) {
							stopped = true;
							controller.close();
							return;
						}
						if (!(chunk.value instanceof Uint8Array))
							throw new TypeError("Expected file bytes");
						controller.enqueue(new Uint8Array(chunk.value));
					} catch (error) {
						if (!stopped) controller.error(error);
					}
				},
				async cancel() {
					stopped = true;
					file?.destroy();
					await iterator.return?.();
				},
			})
		: null;
	return new Response(body, { status: range ? 206 : 200, headers });
}
