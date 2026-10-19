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

## SHA-256

| File | SHA-256 |
| --- | --- |
| `motion-transfer.v1.json` | `ddd20b89a0e2febd53fb7ff14496ee88794faadeb242453346bd72df85f922d0` |
