# Official Wan Animate 2 workflow

`workflow-api.json` is the API-format export of Comfy's `video_wan_animate2` template, downloaded through the signed-in Comfy Cloud editor's **Export (API)** command on 2026-10-18. The frontend expanded the nested subgraphs into 64 executable nodes. This is Wan Animate 2, not Wan 2.2 Animate.

Upstream template and sample inputs were retrieved from [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates/tree/7d8ed32f0bf6b8d52129976535422d6f518fe463). See `LICENSE.upstream` for the repository's MIT license. Model weights have their own upstream terms and are not included in this repository.

- [UI template](https://github.com/Comfy-Org/workflow_templates/blob/7d8ed32f0bf6b8d52129976535422d6f518fe463/templates/video_wan_animate2.json)
- [Reference image](https://github.com/Comfy-Org/workflow_templates/blob/7d8ed32f0bf6b8d52129976535422d6f518fe463/input/pink_hair_mech_arms_ref.png), stored as `fixtures/wan/reference.png`
- [Driving video](https://github.com/Comfy-Org/workflow_templates/blob/7d8ed32f0bf6b8d52129976535422d6f518fe463/input/street_dance_drive.mp4), stored as `fixtures/wan/driving.mp4`
- [Open the template in Comfy Cloud](https://cloud.comfy.org/?template=video_wan_animate2)

## Runtime bindings

`src/server/wan-workflow.server.ts` uploads the samples and sets input assets at nodes `189` and `240`, the appearance/background prompt at `672:582`, the seed at `672:597`, and dimensions at `672:600`. Portrait retains the official 482×854 dimensions. Cinematic swaps them. The take number increments the official seed.

The official motion prompt, six sampling steps, fragment length, model selection, and loop remain in the exported graph. SaveVideo nodes `246` and `292` use MP4/H.264 with a per-render prefix. The application downloads the primary output from `246`; the provider also produces the template's comparison output.

The exact submitted graph is stored alongside the local render in SQLite before submission. Input asset references and runtime overrides do not modify this checked-in export.

## SHA-256

| File | SHA-256 |
| --- | --- |
| `workflow-api.json` | `8d8e3c5a2b9ec60b35f809350482d18e1d68a396960c3549c5c756bc59feb99d` |
| `fixtures/wan/reference.png` | `978ece40869b571fbac430f560a8d4f9174aa0acbdebd074957a070dc480b97f` |
| `fixtures/wan/driving.mp4` | `affc8c474a68b5c17c9f38d80afc689606577ac0951a95097d33f13006c90bd8` |
