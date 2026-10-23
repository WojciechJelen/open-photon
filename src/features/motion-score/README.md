# Motion Score

## Experiment, not shipped

Motion Score is a parked proof of concept, not a feature of Open Photon. Nothing in the app imports
it: no route, no studio card, no navigation entry, no runtime workflow. Its `workflows/` and
`samples/` are in the Docker images only because the images package every feature's folders. It is
kept as a record of what was tried and makes no claim beyond the evidence below.

**What works: driver retiming.** Three source→target frame pins (28→32, 52→48, 64→64) retime the
driver clip inside ComfyUI, before Wan Animate 2, with existing nodes (core, Basic Data Handling
and KJNodes) and no new custom node. Decoding
`samples/results/retimed-driver.mp4` puts source frames 28, 52 and 64 at output frames 32, 48 and
64: zero-frame error on all three pins (`verification/render-check.json`). Moving target 1 from 32
to 31 maps source frame 28 to output frame 31 (`workflows/test_poc.py`); the Cloud run with that
change succeeded (`verification/changed-result.json`, which records the status only). Pins that are
not strictly increasing interior frames, segment speeds outside 0.75–1.5× and a source that is not
81 frames are rejected: the graph's VALIDATE node (id 30) fails with `division by zero`
(`workflows/build_poc.py`; the failed Cloud run is `verification/invalid-result.json`).

**What does not: the character.** The generated character moves but does not reliably reproduce
every pinned pose. In `samples/results/character.mp4` the raised-arms pose of pin 1 (target frame
32, 2 s) is not clearly reproduced. A second render did not recover it: job `2f2596c3…`
(`verification/stronger-result.json`, which records status and timing only; 384×672, eight steps,
pose strength 1.3 per the deleted `features/motion-score.md`, readable with
`git show 833ccd6^:features/motion-score.md`; its video is not kept). The timing of the character's
gestures was never measured: every audit of a character render reports `UNMEASURED`
(`verification/final-editor-run.json`, `verification/fixed-seed-run.json`). There is no pose or
beat detector, no custom-node pack and no app integration. Exact driver pins do not certify
generated gestures.

**Cloud evidence** (`samples/results/`), matching the four outputs of Comfy Cloud job
`eb4247cd-4ac8-46fa-b210-ee570ba4f998` (`verification/generation-result.json`, nodes 41, 44, 61 and
64; the files were presumably renamed from the Cloud output names, and no file records the rename):

- `retimed-driver.mp4` (`driver_00001_.mp4`): the driver after retiming.
- `before-after.mp4` (`before-after_00001_.mp4`): original and retimed driver side by side.
- `character.mp4` (`character_00001_.mp4`): the generated character.
- `driver-character.mp4` (`driver-character_00001_.mp4`): retimed driver and character side by
  side.

All four decode to 81 frames at 16 fps, 5.0625 s, with an audio track
(`verification/render-check.json`).

## What the graph does

The graph takes three SOURCE and three TARGET integer frame controls, compiles a piecewise-linear
time map and selects the matching RGB frames by nearest-frame sampling, all inside ComfyUI before
`WanAnimate2ToVideo`. It uses Comfy's math/text nodes, Basic Data Handling's range/join nodes and
KJNodes' indexed image selection; no new custom node and no partner (API) node, which
`npm run check:open-weights` confirms for every JSON file in `workflows/`.

The demo is 81 frames at 16 fps (288×512). Poses at the pins were chosen by hand; no action
recognition is implemented.

| Pin | Source frame / time | Target frame / time | Segment speed |
| --- | --- | --- | --- |
| 1 | 28 / 1.75 s | 32 / 2 s | 0.875× before pin 1 |
| 2 | 52 / 3.25 s | 48 / 3 s | 1.5× from pin 1 to pin 2 |
| 3 | 64 / 4 s | 64 / 4 s | 0.75× from pin 2 to pin 3, 1× after |

`samples/score-120bpm.wav` is a procedural click track with accents at 2, 3 and 4 s; the source
audio is not reused. The built graph renders one 81-frame Wan Animate 2 fragment with six steps and
fixed seed 218734 (`workflows/motion-score.api.json`, nodes 591 and 597).

The audit takes three OBSERVED frame numbers that a person enters after watching the render (`-1`
for unknown) and reports signed errors in milliseconds, or `UNMEASURED` unless all three are valid.
Its arithmetic was checked with synthetic observations `[32, 49, 62]` → `[0, 62.5, -125]` ms
(`verification/audit-arithmetic-test.json`); those are test values, not observations of the
character. The ±125 ms tolerance is a target, not a pass.

## Files

- `workflows/Motion Score - PoC.json`, `workflows/Motion Score - Timing Preview.json`: visual
  exports of the two personal saved workflows on the Comfy Cloud account that ran them (private,
  not in Comfy's public templates). The PoC adds the character render and audit to the preview.
- `workflows/motion-score.api.json`, `workflows/motion-score-preview.api.json`: executable API
  graphs, written by `build_poc.py` (standard library only; pass a JSON file with `driver`, `audio`
  and `reference` uploaded filenames to bind another account). `layout_poc.py` lays out the visual
  export.
- `workflows/test_poc.py`: Python tests of the time map, pins, invalid maps and audit.
  `workflows/verify_render.py`: decodes the MP4s and checks frames and pins (needs `ffmpeg` and
  `ffprobe`).
- `samples/driver-16fps.mp4`: the driver normalized from `fixtures/wan/driving.mp4`, whose
  provenance and licence are in `src/features/motionTransfer/workflows/wan-animate-2/README.md`.
- `verification/`: Cloud job records and decoded render checks; no credentials.

```bash
python3 -m unittest discover -s src/features/motion-score/workflows -p 'test_*.py'
python3 src/features/motion-score/workflows/verify_render.py
```

The Python files are outside the TypeScript graph, so Fallow does not see them, and no workflow here
is named `<id>.v<N>.json`, so `discoverWorkflows` never loads one.
