# Workflows

`motion-transfer.v1.json` is the executable API-format graph the app submits to Comfy Cloud.

## Origin

It derives from [`wan-animate-2/workflow-api.json`](wan-animate-2/workflow-api.json), the API export of Comfy's official `video_wan_animate2` template from [Comfy-Org/workflow_templates@7d8ed32](https://github.com/Comfy-Org/workflow_templates/tree/7d8ed32f0bf6b8d52129976535422d6f518fe463). The upstream repository is MIT licensed; see [`wan-animate-2/LICENSE.upstream`](wan-animate-2/LICENSE.upstream). [`wan-animate-2/README.md`](wan-animate-2/README.md) records how the export was made and where the sample inputs come from.

## Changes from the export

Two edits, nothing else; the file keeps ComfyUI's formatting.

1. Node `292` and the 13 `291:*` nodes that only it reached are removed.
2. SaveVideo `246` is pinned to `format: mp4`, `format.codec: h264` and `codec: h264` instead of `auto`. The app's player and the share page need H.264 in MP4; the spike set the same three values on every submission, and the Oct 18 render proved them. `filename_prefix` stays `video/ComfyUI`: the app collects the output by node id, not by file name.

`292` is the template's comparison output. It is a second SaveVideo that stitches the frames saved by `246` beside the driving video from `240` (`ImageStitch`, direction right) and encodes the result. The app only downloads `246`, so `292` cost an extra encode and a second output per render for a video nobody receives.

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

`angle` is not a node field. It is a prompt fragment: `generate` appends the phrasing of the chosen preset in [`angles.json`](angles.json) to `prompt` and records the preset's id as the recipe's `angle`, so the angle is part of the recipe and its hash, and it has no entry in the map. The three presets (`front`, `three-quarter`, `profile`) are **placeholders** (`"placeholder": true`): the angle benchmark that is to pick the phrasing has not run.

## App defaults

[`defaults.json`](defaults.json) holds what `generate` uses for a field the user leaves blank: a neutral `prompt` (the character and background of the reference image; the form shows it as the description's placeholder) and a fixed `seed`, so the same choices make the same recipe and reuse its result. Both land in the recipe like given values. The template's own `672:582` text ("Cartoon character lost", an empty white room) is never sent.

Node `672:585` (`CLIPTextEncode`, wired to `WanAnimate2ToVideo.positive_pose`) keeps the template's pose prompt, "A girl doing energetic street dance with rhythmic steps and dynamic arm gestures, background stationary", in every render. It is not an app parameter, so it is not in the inputs map or the recipe; it is part of the workflow file and its SHA-256.

## SHA-256

| File | SHA-256 |
| --- | --- |
| `motion-transfer.v1.json` | `ef8b31e822968f27fd80409d7158a6d7c2ca46cf96b8814427ad15b180a3b1a9` |
