# Official Wan Animate 2 workflow

`workflow-api.json` is the API-format export of Comfy's `video_wan_animate2` template, downloaded through the signed-in Comfy Cloud editor's **Export (API)** command on 2026-10-18. The frontend expanded the nested subgraphs into 64 executable nodes. This is Wan Animate 2, not Wan 2.2 Animate.

Upstream template and sample inputs were retrieved from [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates/tree/7d8ed32f0bf6b8d52129976535422d6f518fe463). See `LICENSE.upstream` for the repository's MIT license. Model weights have their own upstream terms and are not included in this repository.

- [UI template](https://github.com/Comfy-Org/workflow_templates/blob/7d8ed32f0bf6b8d52129976535422d6f518fe463/templates/video_wan_animate2.json)
- [Reference image](https://github.com/Comfy-Org/workflow_templates/blob/7d8ed32f0bf6b8d52129976535422d6f518fe463/input/pink_hair_mech_arms_ref.png), stored as `fixtures/wan/reference.png`
- [Driving video](https://github.com/Comfy-Org/workflow_templates/blob/7d8ed32f0bf6b8d52129976535422d6f518fe463/input/street_dance_drive.mp4), stored as `fixtures/wan/driving.mp4`
- [Open the template in Comfy Cloud](https://cloud.comfy.org/?template=video_wan_animate2)

## Use

The app does not submit this export. It submits [`../motion-transfer.v1.json`](../motion-transfer.v1.json), which is this export without the comparison branch, patched through [`../motion-transfer.v1.inputs.json`](../motion-transfer.v1.inputs.json). [`../README.md`](../README.md) records the differences and the input bindings. This file stays unmodified as the provenance of v1.

## SHA-256

| File | SHA-256 |
| --- | --- |
| `workflow-api.json` | `8d8e3c5a2b9ec60b35f809350482d18e1d68a396960c3549c5c756bc59feb99d` |
| `fixtures/wan/reference.png` | `978ece40869b571fbac430f560a8d4f9174aa0acbdebd074957a070dc480b97f` |
| `fixtures/wan/driving.mp4` | `affc8c474a68b5c17c9f38d80afc689606577ac0951a95097d33f13006c90bd8` |
