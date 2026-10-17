import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { byteRange, serveMedia } from "../src/server/media.server.ts";
import { MAX_UPLOAD_BYTES, uploadMedia } from "../src/server/upload.server.ts";

const directory = mkdtempSync(join(tmpdir(), "comfy-media-"));
process.env.MEDIA_DIRECTORY = directory;
after(() => rmSync(directory, { recursive: true, force: true }));
test("range parser covers bounded, open, suffix and unsatisfiable ranges", () => {
	assert.deepEqual(byteRange("bytes=0-99", 1000), { start: 0, end: 99 });
	assert.deepEqual(byteRange("bytes=900-", 1000), { start: 900, end: 999 });
	assert.deepEqual(byteRange("bytes=-100", 1000), { start: 900, end: 999 });
	assert.equal(byteRange("bytes=1000-", 1000), null);
	assert.equal(byteRange("bytes=10-1", 1000), null);
	assert.equal(byteRange("bytes=-0", 1000), null);
	assert.equal(byteRange("bytes=0-1,4-5", 1000), null);
});
test("GET and HEAD serve a real fixture with accurate range headers", async () => {
	for (const method of ["GET", "HEAD"]) {
		const response = await serveMedia(
			new Request("http://localhost/media/x.mp4", {
				method,
				headers: { Range: "bytes=0-99" },
			}),
			"x.mp4",
		);
		assert.equal(response.status, 206);
		assert.match(
			response.headers.get("content-range") ?? "",
			/^bytes 0-99\/[0-9]+$/,
		);
		assert.equal(response.headers.get("content-length"), "100");
		assert.equal(
			(await response.arrayBuffer()).byteLength,
			method === "HEAD" ? 0 : 100,
		);
	}
	const invalid = await serveMedia(
		new Request("http://localhost/media/x.mp4", {
			headers: { Range: "bytes=999999999-" },
		}),
		"x.mp4",
	);
	assert.equal(invalid.status, 416);
});
test("multipart uploads stream to a file that supports seeking", async () => {
	const form = new FormData();
	form.append(
		"file",
		new Blob([new Uint8Array(1000)], { type: "video/mp4" }),
		"test.mp4",
	);
	const response = await uploadMedia(
		new Request("http://localhost/api/uploads", { method: "POST", body: form }),
	);
	assert.equal(response.status, 201);
	const data: unknown = await response.json();
	assert.ok(
		typeof data === "object" &&
			data !== null &&
			"filename" in data &&
			typeof data.filename === "string",
	);
	const video = await serveMedia(
		new Request("http://localhost/media/test", {
			headers: { Range: "bytes=-50" },
		}),
		data.filename,
	);
	assert.equal(video.status, 206);
	assert.equal((await video.arrayBuffer()).byteLength, 50);
});
test("large declared bodies are rejected before writing", async () => {
	const response = await uploadMedia(
		new Request("http://localhost/api/uploads", {
			method: "POST",
			body: "x",
			headers: {
				"Content-Type": "multipart/form-data; boundary=test",
				"Content-Length": String(MAX_UPLOAD_BYTES + 65537),
			},
		}),
	);
	assert.equal(response.status, 413);
});
test("invalid multipart and missing file bodies are rejected", async () => {
	assert.equal(
		(
			await uploadMedia(
				new Request("http://localhost/api/uploads", {
					method: "POST",
					body: "bad",
				}),
			)
		).status,
		415,
	);
	const form = new FormData();
	form.append("file", new Blob(["x"]), "bad.txt");
	assert.equal(
		(
			await uploadMedia(
				new Request("http://localhost/api/uploads", {
					method: "POST",
					body: form,
				}),
			)
		).status,
		400,
	);
});
