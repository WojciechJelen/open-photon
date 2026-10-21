# Motion Score

Updated 2026-10-21. Runnable Comfy Cloud PoC, verified on the signed-in MuscularDeveloper account.

## Saved workflows

- [Motion Score - PoC](https://cloud.comfy.org/#e4a2448d-f130-4761-9fbc-403110d71874): retiming, Wan Animate 2 generation, comparisons, and manual audit.
- [Motion Score - Timing Preview](https://cloud.comfy.org/#ccd42f59-1364-4aab-b60e-8c5258bff8a6): retiming and before/after video only.

Both are personal saved workflows, reusable as templates from **Workflows**. They are not published in Comfy's public Templates catalog. The original blank workflow was replaced. Local visual exports are in `src/features/motion-score/workflows/` with these same names.

## What works

The graph exposes three SOURCE and three TARGET integer frame controls. It compiles a piecewise-linear time map and selects corresponding RGB frames using nearest-frame sampling **inside ComfyUI**, before `WanAnimate2ToVideo`. No new custom node installation or external retiming service is required. It uses Comfy's math/text nodes, Basic Data Handling's range/join nodes, and KJNodes' indexed image selection.

The demo uses 81 frames at 16 fps, lasting 5.0625 seconds. The source is normalized to 288×512. Poses are manually selected; no action recognition is implemented.

| Pin | Source frame/time | Target frame/time | Segment speeds |
| --- | --- | --- | --- |
| 1 | 28 / 1.75 s | 32 / 2 s | 0.875× before pin 1 |
| 2 | 52 / 3.25 s | 48 / 3 s | 1.5× from pin 1 to pin 2 |
| 3 | 64 / 4 s | 64 / 4 s | 0.75× from pin 2 to pin 3; 1× afterward |

The synthesized 120 BPM click track has stronger accents at 2, 3, and 4 seconds. Every output uses this target audio and the fixed 16 fps clock. The original source audio is not reused.

The full graph renders one 81-frame Wan Animate 2 fragment at 288×512 with six sampling steps, fixed seed 218734, and an int8 pose cache in CPU memory. It exports four MP4s: scored driver, original/scored comparison, generated character, and scored-driver/character comparison.

## How to use

1. Open **Motion Score - Timing Preview** to adjust timing without character generation.
2. Edit SOURCE/TARGET controls. Frame 16 is 1 second; frame 32 is 2 seconds. Keep all three pins ordered and strictly between 0 and 80.
3. Run and inspect the two videos. The graph rejects non-increasing pins, wrong source frame counts, and segment speeds outside 0.75–1.5×. Rejection appears as `division by zero` at VALIDATE; this is the current PoC error presentation.
4. Copy the selected pin values into **Motion Score - PoC** and Run.
5. Inspect generated events independently. Enter their observed frame numbers in OBSERVED only when all three events are identifiable and ordered. Leave `-1` for unknown events. The audit reports UNMEASURED unless all observations are valid; otherwise it reports signed errors in milliseconds, preserving half milliseconds. The suggested ±125 ms tolerance is a target, not a certified pass.

Replacement source inputs must already have 81 frames at 16 fps. Replacement soundtrack length must match 5.0625 seconds. This fixed-duration PoC does not normalize arbitrary uploads or trim/pad arbitrary audio in the graph. Its frame-count check does not validate source FPS. Pin edits are not automatically synchronized between the two workflows.

## Verified results

- Preview job `508274a7-6663-4df5-aaf1-4494e59a7db0` succeeded from the browser editor.
- Full generation job `eb4247cd-4ac8-46fa-b210-ee570ba4f998` succeeded from the editor and exported all four MP4s. The service reported 16,877 ms execution and 2,801 ms queue time for this run; these are not general runtime guarantees.
- Decoded MP4 checks found 81 frames at 16 fps in all four outputs. Video duration is 5.0625 s; encoded audio duration is 5.062 s, within one video frame.
- Comparing the decoded retimed video against the decoded source confirmed source frames 28, 52, and 64 at output frames 32, 48, and 64. All three driver pins have zero-frame error.
- Changed-pin job `ef16e418-d056-48ec-a12f-4c4dc7f8847d` succeeded. Changing target 1 from 32 to 31 moved source frame 28 to output frame 31, verified from the returned MP4.
- Invalid-pin job `c4861120-ee52-4059-87e4-0ed1aa913ccb` failed at validation for duplicate target pins, as intended.
- Fixed-seed rerun `376d1b55-19d7-4818-bf3f-b6217e445998` completed with four videos and the explicit UNMEASURED audit. The editor still showed seed 218734 and Fixed Value afterward. Both saved workflows were verified in the account library.
- The final saved visual graph ran successfully as job `6df5fa78-4daa-4883-a052-2fe78d12dc5b`; its actual audit output was UNMEASURED.
- A separate Cloud audit-arithmetic test with synthetic observations `[32, 49, 62]` returned errors `[0.0, 62.5, -125.0]` ms. These test numbers are not observations of the character.
- `npm run check` passed (typecheck, lint, formatting, and dead-code/duplication checks).
- Six Python tests cover identity mapping, exact pins, monotonicity/endpoints, invalid maps, changed pins, graph connections, and unknown audit behavior.

The generated character moves but does **not** reliably reproduce every pinned pose. The first source pin includes raised arms that were not clearly reproduced. A second render at 384×672, eight steps, and pose strength 1.3 also did not recover that gesture. That experiment succeeded technically (`2f2596c3-a6c3-462b-9ce2-ca80595994d0`, 31,756 ms execution) but was not adopted as the default. Generated gesture timing remains **unmeasured**. Exact driver retiming is demonstrated; generated-character beat accuracy is not established. There is no automatic pose detector, beat detector, retry loop, or silent corrective retime.

## Local artifacts and reproduction

All feature artifacts are under `src/features/motion-score/`:

- `workflows/`: visual JSON, executable API graphs, builder, layout helper, tests, and MP4 verification script.
- `samples/driver-16fps.mp4` and `samples/score-120bpm.wav`: normalized driver and procedural soundtrack.
- `samples/results/`: actual Cloud outputs, including `before-after.mp4`, `character.mp4`, and `driver-character.mp4`.
- `verification/`: job records and decoded render checks. These files contain no API credentials.

```bash
python3 -m unittest discover -s src/features/motion-score/workflows -p 'test_*.py'
python3 src/features/motion-score/workflows/verify_render.py
```

The verification script requires `ffmpeg` and `ffprobe`. The builder uses only Python's standard library. Running `build_poc.py` regenerates API graphs with portable local filenames and the click track; pass a JSON file with `driver`, `audio`, and `reference` uploaded filenames to bind another account. Saved visual exports currently reference assets uploaded to this account. On another account, upload the provided driver/audio and `fixtures/wan/reference.png` through their loader nodes. No application routes were added.

## Provenance and references

The driver and character reference are the repository's existing `fixtures/wan/` assets, originally retrieved from the [official Comfy workflow templates](https://github.com/Comfy-Org/workflow_templates/tree/7d8ed32f0bf6b8d52129976535422d6f518fe463). Original hashes and the upstream license location are recorded in `src/features/motionTransfer/workflows/wan-animate-2/README.md`. The normalized driver derives from that clip; the soundtrack contains procedural tones rather than third-party music. Model weights retain their own upstream terms.

The generation path derives from the checked-in official Wan Animate 2 API graph. Node availability and schemas were checked against this account's live `/api/object_info`. [Comfy Cloud API documentation](https://docs.comfy.org/development/cloud/api-reference) documents uploads, node inspection, and execution. The initial specification is section A of `docs/priv/custom-nodes-ideation-report.md`.
