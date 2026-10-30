# Sprite Forge workflows

Two runtime workflows, both written by `build_workflows.py` (standard library Python) with their inputs maps. The prototype that validated every choice below, with its Cloud jobs, loop scores and results, is in [`../README.md`](../README.md).

## `sprite-view.v1.json`: one direction view

`angle-view.v1.json` of Shots & Angles (Qwen-Image-Edit-2511 + the fal Multiple-Angles LoRA + the lightx2v Lightning 4-step LoRA, see [its README](../../angles/workflows/README.md)) with one change: `SaveImage` `2` saves under `sprite_view`. A set renders it five times, one direction each, with the same seed.

The inputs (`sprite-view.v1.inputs.json`), the same bindings as `angle-view.v1`:

- `reference_image`, bound to `1.image`: the library character's image, uploaded by SHA-256.
- `prompt`, bound to `151.prompt`: the direction's phrase in the LoRA's vocabulary (`view-definition.ts`):

  | Direction | Prompt |
  | --- | --- |
  | s | `<sks> front view eye-level shot medium shot` |
  | sw | `<sks> front-right quarter view eye-level shot medium shot` |
  | w | `<sks> right side view eye-level shot medium shot` |
  | nw | `<sks> back-right quarter view eye-level shot medium shot` |
  | n | `<sks> back view eye-level shot medium shot` |

- `seed`, bound to `169.seed`.

Output: `SaveImage` `2`, the `image`.

## `sprite-sheet.v1.json`: five views into a walk-cycle sheet

One graph from the five views to both atlases (134 nodes with three takes, 84 with one). Per direction:

- `LoadImage` (the view) → `ImageScale` (lanczos, 480×832, crop center) → `RemoveBackground` (shared `LoadBackgroundRemovalModel`, BiRefNet) → `ImageCompositeMasked` onto a shared `EmptyImage` 480×832 of grey `0xB4B4B4`, so Wan animates the character and not a background.
- Per take: `WanFirstLastFrameToVideo` with the composite as both first and last frame (a closed loop, 49 frames) → `KSamplerAdvanced` high noise (steps 0→2, adds the noise) → `KSamplerAdvanced` low noise (2→end) → `VAEDecode` → `RemoveBackground` of the frames (MASK, 1 = character). The text encoder, VAE, both Wan 2.2 i2v experts, both lightx2v 4-step LoRAs and `ModelSamplingSD3` (shift 5) are shared and are the nodes of `animate-image.v1.json`, as are the sampler settings (4 steps, cfg 1, euler, simple) and the negative prompt. The walk prompt is the prototype's `WALK_PROMPT`; north uses `WALK_PROMPT_BACK`, which keeps the back to the camera.
- `SpriteLoopCut` (take 1 as `frames`/`mask`, takes 2 and 3 as `frames_2`/`mask_2`/`frames_3`/`mask_3`; 10–32 frames, keeps 8) picks the take with the lowest seam ratio → `SpritePivotLock` (128×160 cells, fill 0.92, alpha threshold 0.5).

Then eight chained `SpriteRow` nodes, `901`–`908` in `sheetRows` order, tagged `walk_<row>`: s, sw, w, nw and n from their own direction, ne, e and se from nw, w and sw. Each row takes its frames and pivot from its source direction's `SpritePivotLock`, and the kept take and seam ratio from its `SpriteLoopCut` (into the atlas JSON's `meta.loops`). The atlases:

- HD: `SpriteAtlasPack` `910` (fps 10, `meta.image` `hd.png`) → `SaveImage` `911` and `SaveText` `912` (prefix `sprite_hd`).
- Pixel: `SpriteRescale` `920` (48×60) → `SpritePalette` `921` (24 colours, outline, alpha threshold 0.5) → `SpriteAtlasPack` `922` (fps 10, `pixel.png`) → `SaveImage` `923` and `SaveText` `924` (prefix `sprite_pixel`).

Outputs: `911` `hd` (RGBA PNG), `912` `hd-json`, `923` `pixel`, `924` `pixel-json` (compact Aseprite JSON array). Core `SaveImage`/`SaveText` save them so the fake provider can emit them too.

### Node ids

Ids are numeric strings, so the server prunes takes by id alone:

- Shared nodes: `1`–`999` (loaders, prompts, the matting model, the grey background, the rows `901`–`908`, the atlases `910`–`924`).
- Direction `d` (1..5 in `spriteDirections` order: s, sw, w, nw, n) owns `d * 1000 + 1…99` for its take-independent nodes (`+1` the view's `LoadImage`, `+5` `SpriteLoopCut`, `+6` `SpritePivotLock`) and `d * 1000 + t * 100 + 1…99` for take `t` (`+2` the high-noise sampler).
- A node is a take-`t` node iff `id >= 1000 && Math.floor((id % 1000) / 100) === t`. A take-2 or take-3 node feeds only its own take or its direction's `SpriteLoopCut` `frames_t`/`mask_t`, so a one-take sheet deletes those nodes and those four `SpriteLoopCut` inputs and has no dangling link. The builder asserts this before writing.

### Inputs (`sprite-sheet.v1.inputs.json`)

- `view_s`, `view_sw`, `view_w`, `view_nw`, `view_n`: `LoadImage.image` at `1001`, `2001`, `3001`, `4001`, `5001`, each a done view's image uploaded by SHA-256.
- `seed_1`, `seed_2`, `seed_3`: the high-noise sampler's `noise_seed` of take `t` in every direction (`d * 1000 + t * 100 + 2`); the definition binds `seed`, `seed + 1` and `seed + 2`.
- `flip_sw`, `flip_w`, `flip_nw`, `flip_ne`, `flip_e`, `flip_se`: `SpriteRow.flip_horizontal` of rows `902`, `903`, `904`, `906`, `907`, `908`. West rows need a character facing left and east rows one facing right, so the definition flips from the facing the user confirmed. Rows `901` (s) and `905` (n) are never flipped.

The file holds neutral values in the bound fields: seeds 0, `view.png`, no flips.

### Self-host only

`SpriteLoopCut`, `SpritePivotLock`, `SpriteRow`, `SpriteRescale`, `SpritePalette` and `SpriteAtlasPack` are the Sprite Forge custom nodes (`../comfy_nodes/sprite_forge`). Comfy Cloud runs no user custom nodes, so the sheet renders only on the self-hosted image, which installs the pack; the definition refuses a Cloud target with 422 `selfhost_required`. Every other class is core at the pin (ComfyUI 0.42.0).

## Models (`models.lock`)

One lock for both graphs, each entry copied unchanged from the feature that already pins it, so the aggregate lock has one pin per file:

- Qwen-Image-Edit-2511 bf16, Qwen 2.5 VL 7B fp8, the Qwen-Image VAE, the fal Multiple-Angles LoRA and the lightx2v Qwen Lightning LoRA, as `angles` pins them. Apache-2.0.
- Wan 2.2 i2v 14B high- and low-noise experts (fp8 scaled), both lightx2v Wan 4-step LoRAs, `wan_2.1_vae` and `umt5_xxl_fp8_e4m3fn_scaled`, as `animateImage` pins them. Apache-2.0.
- `birefnet.safetensors` (`Comfy-Org/BiRefNet`), as `productStudio` pins it. MIT.

## Regenerating

```bash
python3 src/features/spriteForge/workflows/build_workflows.py
npx oxfmt src/features/spriteForge/workflows
```

The builder copies `angle-view.v1.json` and the Wan nodes of `animate-image.v1.json`, so a change there reaches these files only when they are regenerated (which changes their SHA-256, and so the definitions' `rebase`).

## Not verified

- The sheet graph as one job has not run: the prototype ran its two halves apart (Cloud walks, local CPU sheet). Latency, cost per sheet (15 clips with three takes, 5 with one) and peak VRAM on a self-host GPU are not measured.
