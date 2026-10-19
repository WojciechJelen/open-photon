import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { runTool } from "../src/server/media/probe.ts";
import { trimVideo } from "../src/server/media/trim.ts";

const directory = mkdtempSync(join(tmpdir(), "open-photon-trim-"));

after(() => rmSync(directory, { force: true, recursive: true }));

test("an 8 s cut keeps AAC audio and lasts 7.9–8.0 s, copied on a keyframe and re-encoded off one", async () => {
  // The fixture's keyframes are at 0 s and 10.4 s.
  for (const [startMs, mode] of [
    [0, "copy"],
    [1500, "encode"],
  ] as const) {
    const output = join(directory, `${startMs}.mp4`);
    assert.equal(await trimVideo("tests/fixtures/long-12s.mp4", output, startMs, 8000), mode);

    const { stdout } = await runTool("ffprobe", [
      "-show_entries",
      "format=duration:stream=codec_name",
      "-print_format",
      "json",
      output,
    ]);

    const result = JSON.parse(stdout);
    const seconds = Number(result.format.duration);
    assert.ok(seconds >= 7.9 && seconds <= 8, `${mode}: ${seconds} s`);
    assert.deepEqual(
      result.streams.map((stream: { codec_name: string }) => stream.codec_name),
      ["h264", "aac"],
    );
  }
});
