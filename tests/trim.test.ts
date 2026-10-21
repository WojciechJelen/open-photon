import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { probe, runTool } from "../src/features/motionTransfer/server/media/probe.ts";
import { trimVideo } from "../src/features/motionTransfer/server/media/trim.ts";

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

test("an off-keyframe cut of an odd-sized clip pads it to even dimensions", async () => {
  // H.264 4:4:4 allows odd sizes; the 4:2:0 re-encode does not.
  const input = join(directory, "odd.mp4");
  // prettier-ignore
  await runTool("ffmpeg", [
    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24", "-t", "5",
    "-vf", "format=yuv444p,scale=321:241", "-c:v", "libx264", "-g", "600", input,
  ]);

  const output = join(directory, "odd-cut.mp4");
  assert.equal(await trimVideo(input, output, 500, 3000), "encode");

  const info = await probe(output);
  assert.deepEqual(info?.video && { height: info.video.height, width: info.video.width }, {
    height: 242,
    width: 322,
  });
  assert.equal(info?.durationMs, 3000);
});
