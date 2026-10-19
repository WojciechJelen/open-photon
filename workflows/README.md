# Workflows

`motion-transfer.v1.json` is the executable API-format graph the app submits to Comfy Cloud.

## Origin

It derives from [`wan-animate-2/workflow-api.json`](wan-animate-2/workflow-api.json), the API export of Comfy's official `video_wan_animate2` template from [Comfy-Org/workflow_templates@7d8ed32](https://github.com/Comfy-Org/workflow_templates/tree/7d8ed32f0bf6b8d52129976535422d6f518fe463). The upstream repository is MIT licensed; see [`wan-animate-2/LICENSE.upstream`](wan-animate-2/LICENSE.upstream). [`wan-animate-2/README.md`](wan-animate-2/README.md) records how the export was made and where the sample inputs come from.

## Changes from the export

Node `292` and the 13 `291:*` nodes that only it reached are removed. Nothing else is edited: the file is the export with those nodes deleted, in ComfyUI's formatting.

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
| `width`, `height` | `672:600.resize_type.width`, `.height` (`ResizeImageMaskNode`) | `WanAnimate2ToVideo` reads its size from `GetImageSize` `672:596`, which measures the driving frames after this resize. The model rounds down to multiples of 16, so 482×854 renders at 480×848. |
| `frames` | `672:635.value` (`PrimitiveInt`, "fragment_length") | `WanAnimate2ToVideo.length` is wired through the switch `672:646` to this literal. The template renders the driving clip in a loop of windows of this many frames (81, keep it 4n+1) and trims the result to the clip's own frame count, so the output always has as many frames as the driving clip. Clip length is set by trimming the upload (Step 3.2), not by this value. |

`angle` is not a node field. It is a prompt fragment the app appends to `prompt` (`workflows/angles.json`, Step 5.3), so it has no entry in the map.

## SHA-256

| File | SHA-256 |
| --- | --- |
| `motion-transfer.v1.json` | `ddd20b89a0e2febd53fb7ff14496ee88794faadeb242453346bd72df85f922d0` |
