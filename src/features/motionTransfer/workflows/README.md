# Workflows

`motion-transfer.v1.json` is the executable API-format graph the app submits to Comfy Cloud.

## Origin

It derives from [`wan-animate-2/workflow-api.json`](wan-animate-2/workflow-api.json), the API export of Comfy's official `video_wan_animate2` template from [Comfy-Org/workflow_templates@7d8ed32](https://github.com/Comfy-Org/workflow_templates/tree/7d8ed32f0bf6b8d52129976535422d6f518fe463). The upstream repository is MIT licensed; see [`wan-animate-2/LICENSE.upstream`](wan-animate-2/LICENSE.upstream). [`wan-animate-2/README.md`](wan-animate-2/README.md) records how the export was made and where the sample inputs come from.

## Changes from the export

Two edits, nothing else; the file keeps ComfyUI's formatting.

1. Node `292` and the 13 `291:*` nodes that only it reached are removed.
2. SaveVideo `246` is pinned to `format: mp4`, `format.codec: h264` and `codec: h264` instead of `auto`. The app's player and the share page need H.264 in MP4; the spike set the same three values on every submission, and the Oct 18 render proved them. `filename_prefix` stays `video/ComfyUI`: the app collects the output by node id, not by file name.

`292` is the template's comparison output. It is a second SaveVideo that stitches the frames saved by `246` beside the driving video from `240` (`ImageStitch`, direction right) and encodes the result. The app only downloads `246`, so `292` cost an extra encode and a second output per render for a video nobody receives. The app makes that comparison itself at finalize instead, on the CPU, with FFmpeg: the output `compare`, a vertical 1080×1920 MP4 of the driving clip beside a portrait or square result (above a landscape one), with the result's audio (`stitchCompare`, [`../server/media/compare.ts`](../server/media/compare.ts)).

| | Export | v1 |
| --- | --- | --- |
| Nodes | 64 | 50 |
| Outputs | `246`, `292` | `246` |

## Inputs map

[`motion-transfer.v1.inputs.json`](motion-transfer.v1.inputs.json) is the only place that knows which node and field each app parameter patches. Every entry names the node's `class_type`, so a map that drifts from the graph fails loudly instead of patching the wrong node. Each mapped field holds a literal in the graph; where the obvious field is wired from another node, the map follows the wire to the node that holds the literal:

| Param | Node.field | Why there |
| --- | --- | --- |
| `driving_video` | `240.file` (`LoadVideo`) | |
| `reference_image` | `189.image` (`LoadImage`) | |
| `prompt` | `672:582.text` (`CLIPTextEncode`) | The node wired to `WanAnimate2ToVideo.positive`. `672:585` feeds `positive_pose` and `672:581` is the negative prompt. |
| `seed` | `672:597.noise_seed` (`SamplerCustom`) | |
| `width`, `height` | `672:600.resize_type.width`, `.height` (`ResizeImageMaskNode`) | `WanAnimate2ToVideo` reads its size from `GetImageSize` `672:596`, which measures the driving frames after this resize. The node allocates its latent as `width // 8` × `height // 8` ([`comfy_extras/nodes_wan.py`](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_wan.py)), so the output is the resize rounded down to a multiple of 8: 482×854 renders at 480×848. |
| `fragment_length` | `672:635.value` (`PrimitiveInt`, "fragment_length") | `WanAnimate2ToVideo.length` is wired through the switch `672:646` to this literal. The template renders the driving clip of F frames in a loop of windows of this many frames, each after the first overlapping the previous one by a frame, and trims the result to F (`672:670`). `672:636` divides by `fragment_length - 1` and Wan's temporal latent holds `((length - 1) // 4) + 1` frames, so the params schema accepts only 4n + 1 values from 5 to 81. 81 is the template default and the clip length Wan was trained on (5 s at 16 fps); longer windows are untested and need more GPU memory per window. With a valid value and a driving clip of at least 2 frames, the output has F frames: the 121-frame sample clip at 81 renders windows of 81 and 41 frames, 121 after the overlap. A 1-frame clip gives `floor((1 - 2) / 80) + 1 = 0` loop iterations and no output. Clip length is set by trimming the upload (Step 3.2), not by this value. |

## Angle presets

There are none. Until DEV-282 the Direct step offered three reshoot angles (`front`, `three-quarter`, `profile`) as prompt fragments: `prepareRecipe` appended the chosen preset's phrasing from `angles.json` to `prompt` and recorded its id as the recipe's `angle`. They were placeholders that no render had tested, so the [angle benchmark of 2026-10-23](../../../../docs/angle-benchmark-2026-10-23/index.md) tested them, and the picker, `angles.json` and `anglePresets` were removed after it.

**Benchmark.** The `street-dance` sample × one builder character (generation `9fecc302-8df2-4dc9-9cd3-d6a491cdf805`, character `0eb77040-c50f-4746-8e11-cd71c5e4262c`), seed `20261019`, the `defaults.json` prompt plus each fragment, ten Cloud takes one at a time: the no-fragment baseline `7d4e4241-c787-4c71-8075-ba3d3f040030` and nine phrasings, camera-centric and subject-centric for each angle, the two shipped placeholders and one spelled-out side view (front `8b85e9ab-ffc5-4a86-8c73-582809243eaa`, `49225948-48cb-4e4c-b10e-a2b4d903203c`; three-quarter `493495c1-c5a3-48e4-b374-d256a2c60b12`, `2c3c5f41-be08-49f4-9dc2-5ce9eb58abb1`, `e10c27d2-aa14-450d-976c-14d91cbe40ba`; profile `a374a409-099d-4551-b6a5-5c0ed3ef2136`, `5ef34014-86fe-4b3d-8068-4927ae3a1882`, `15e44087-330c-4c38-9998-f3ad045595d9`, `90995066-3974-48b2-a6b2-07be6c6285a6`). Stills at 0.5 s, 2.5 s and 4.5 s, the fragments and a verdict per take are in the benchmark's `index.md`.

**Decision: remove the picker.** No fragment changed the camera or turned the body: every take keeps the clip's framing and the dancer's facing frame for frame, while the motion transfers in all ten. The front fragments, which ask for nothing the clip does not already show, perturb the render as much (whole-clip SSIM against the baseline 0.868, 0.879) as the three-quarter and profile ones (0.873–0.919): seed-level differences in detail and crop, not orientation. `WanAnimate2ToVideo` draws the character onto the clip's extracted pose (`pose_video`); the positive prompt conditions appearance only. A control that renders the same shot under three names is worse than none.

The recipe schema keeps an optional `angle` so the recipes of takes made with a preset still parse and hash as they did; their `params.prompt` ends with the old phrasing, which "Change the shot" carries in the look. New recipes have no `angle`, and `POST /api/generate` no longer reads one.

## App defaults

[`defaults.json`](defaults.json) holds what `prepareRecipe` ([`definition.ts`](definition.ts)) uses for a field the user leaves blank: a neutral `prompt` (the character and background of the reference image; the form shows it as the description's placeholder) and a fixed `seed`, so the same choices make the same recipe and reuse its result. Both land in the recipe like given values. The template's own `672:582` text ("Cartoon character lost", an empty white room) is never sent.

Node `672:585` (`CLIPTextEncode`, wired to `WanAnimate2ToVideo.positive_pose`) keeps the template's pose prompt, "A girl doing energetic street dance with rhythmic steps and dynamic arm gestures, background stationary", in every render. It is not an app parameter, so it is not in the inputs map or the recipe; it is part of the workflow file and its SHA-256.

## SHA-256

| File | SHA-256 |
| --- | --- |
| `motion-transfer.v1.json` | `ef8b31e822968f27fd80409d7158a6d7c2ca46cf96b8814427ad15b180a3b1a9` |
