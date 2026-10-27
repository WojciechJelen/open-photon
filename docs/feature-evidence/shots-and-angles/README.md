# Shots & Angles: ComfyUI gate, 2026-10-27

**Verdict: pass with one workflow, Qwen-Image-Edit-2511 plus the fal Multiple-Angles LoRA and the lightx2v 4-step Lightning LoRA (candidate A).** Across 4 characters it really changes the viewpoint: three-quarter views are turned about 45°, profiles show the head and whole body from the side, and close-ups are new head-and-shoulders renders, not crops. Identity and outfit hold. The in-schema candidates failed. FLUX 3 Klein edit (D) often did not turn the body. Qwen-Image-Edit-2511 without LoRAs at 40 steps (C) over-rotated the three-quarter view to a near-profile on both characters it was run on. It also cost about 8× more. The coordinator approved the two out-of-schema LoRA repositories by id (Foundation commit `6192622`).

Why a dedicated workflow: [`docs/angle-benchmark-2026-10-23/`](../../angle-benchmark-2026-10-23/index.md) showed that camera phrasing in the Motion Transfer (Wan Animate 2) prompt never moves the camera. This gate therefore tests image-edit workflows only.

## Setup

- **Backend:** Comfy Cloud (ComfyUI 0.43.0). Every run went through `feature-coord/comfy-run.ts`, the lease-holding runner that uses this repository's `createSdkProvider`.
- **Inputs** ([`sheets/inputs.jpg`](sheets/inputs.jpg), 768×1344, all FLUX 3 Klein `character-generation.v1` renders):
  - `hiker` is the difficult case. It was rendered for this gate (seed 20261027, [`runs/input-hiker.run.json`](runs/input-hiker.run.json), 0.72¢) and every detail is one-sided: the braid falls over her right shoulder, the red patch is on her left chest, a water bottle sits in the backpack's left pocket and a teal bandana is tied on her left wrist.
  - `maya` (photo), `theo` (stylized 3D) and `yuki` (anime) are the repository's sample characters (`src/features/characters/samples/characters/`).
- **Per case:** one character went through one workflow as one API graph with five branches that share the loaders: `baseline`, `front`, `three-quarter`, `profile`, `close-up`. Every branch has seed 20261027, and the branches differ only in their prompt. The graphs are in [`graphs/`](graphs/). One single-view run measured the per-image latency the app sees: [`runs/A-single-hiker-threequarter.run.json`](runs/A-single-hiker-threequarter.run.json).
- **What separates a viewpoint change from an incidental one:**
  - `front` is the same-seed reference. A turn has to differ from it in body orientation, not just in detail.
  - `baseline` is a neutral prompt with the same seed: an empty prompt for A, "Keep the person… exactly as they are" for B–D. It shows how much a render drifts with no camera instruction.
  - `close-up` is compared with a crop of the input's upper body, left, which is wider than the close-up and holds all the input's pixels there ([`sheets/crop-vs-closeup-hiker.jpg`](sheets/crop-vs-closeup-hiker.jpg), [`sheets/crop-vs-closeup-maya.jpg`](sheets/crop-vs-closeup-maya.jpg)). The close-up, right, is tighter and has new detail at that distance (skin, eyes, hair strands, fabric, patch stitching) that upscaling a crop cannot add.
- **Sheets:** each sheet shows, left to right, input, baseline, front, three-quarter, profile and close-up (`sheets/<workflow>--<character>.jpg`, downscaled). Full-resolution outputs are in the ignored `work/feature-evidence/shots-and-angles/`.

## Workflows

| Id | Graph | Models (Cloud) | Prompts | In models.lock schema |
| --- | --- | --- | --- | --- |
| A | `qwen2511-angles-lightning`: the subgraph of `template_qwen_multiangle.app.json` / `templates-1_click_multiple_character_angles-v1.0.json` (workflow_templates `3c2199b`), flattened by hand. `FluxKontextImageScale` → `TextEncodeQwenImageEditPlus` (+ `FluxKontextMultiReferenceLatentMethod` `index_timestep_zero`) → UNet → angles LoRA → `ModelSamplingAuraFlow` 3.1 → `CFGNorm` 1 → Lightning LoRA → `KSampler` (4 steps, cfg 1, euler/simple) | `qwen_image_edit_2511_bf16`, `qwen_2.5_vl_7b_fp8_scaled`, `qwen_image_vae`, `qwen-image-edit-2511-multiple-angles-lora` (fal), `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16` (lightx2v) | the LoRA's own format, `<sks> <azimuth> <elevation> <distance>`: front `front view eye-level shot medium shot`, ¾ `front-right quarter view …`, profile `right side view …`, close-up `front view eye-level shot close-up` | approved by id (`6192622`) |
| B | A without the angles LoRA | A minus the fal LoRA | explicit camera sentences, e.g. "Change only the camera: orbit the camera 45 degrees around to the person's right side … Keep the same person, face, hair, outfit…" | no (lightx2v) |
| C | A without both LoRAs: 40 steps, cfg 4 | Comfy-Org files only | as B | yes |
| D | Foundation's `flux3-klein-edit.api.json` (`ReferenceMultiLatent`, 16 steps) | FLUX 3 Klein int8, qwen3vl 4B, flux2 VAE (characterBuilder's pins) | as B | yes |

Qwen-Image-2.1 edit was not run: Foundation found its licence is the Qwen research licence, which is non-commercial.

## Results (per view)

✔ pass, ✖ fail, ~ passes the viewpoint gate with a detail noted.

| Workflow | Character | Front | Three-quarter (≈45°) | Profile (side of head and body) | Close-up (re-rendered, not a crop) | Baseline (neutral, same seed) |
| --- | --- | --- | --- | --- | --- | --- |
| [A](sheets/A-qwen2511-angles-lightning--hiker.jpg) | hiker | ✔ ≈ input | ~ real ≈45° turn (her right side shown); patch and bandana on the correct side, but the **bottle moved to the visible pocket** (it is in the left pocket, which this side hides) | ✔ true side view (her left side): bottle in the left pocket, bandana on the left wrist, patch at the front edge, braid mostly hidden, all consistent | ✔ new head-and-shoulders render; patch and straps consistent | background changed to a forest |
| [A](sheets/A-qwen2511-angles-lightning--maya.jpg) | maya | ✔ | ✔ ≈45° | ✔ | ✔ | adds a city background and a black patch on the hoodie |
| [A](sheets/A-qwen2511-angles-lightning--theo.jpg) | theo | ✔ | ✔ ≈45°, stripes on the correct side | ✔ | ✔ freckles and eyes re-rendered | ≈ input |
| [A](sheets/A-qwen2511-angles-lightning--yuki.jpg) | yuki | ✔ | ✔ ≈45° (her left side, sleeve pocket shown on the correct arm) | ~ side view of head and body, but the left-sleeve pocket appears on the near (right) arm and an extra sleeve patch is added | ✔ | turned to a **back view** |
| [B](sheets/B-qwen2511-lightning--hiker.jpg) | hiker | ✔ | ✖ ≈80–90°, a near profile | ✔ | ✔ | ≈ input |
| [B](sheets/B-qwen2511-lightning--maya.jpg) | maya | ✔ | ✖ ≈90°, a profile | ✔ | ✔ | ≈ input |
| [C](sheets/C-qwen2511-base40--hiker.jpg) | hiker | ✔ | ✖ ≈70–90°, a near profile | ✔ | ✔ | ≈ input |
| [C](sheets/C-qwen2511-base40--maya.jpg) | maya | ✔ | ✖ ≈90°, a profile | ✔ | ✔ | ≈ input |
| [D](sheets/D-flux3-klein-edit--hiker.jpg) | hiker | ✔ | ✖ no turn, identical to front | ✖ only the head turns, the body stays frontal | ✔ | ≈ input |
| [D](sheets/D-flux3-klein-edit--maya.jpg) | maya | ✔ | ✖ ≈15° | ✔ | ✔ | ≈ input |
| [D](sheets/D-flux3-klein-edit--theo.jpg) | theo | ✔ | ✔ | ✔ | ✔ | ≈ input |
| [D](sheets/D-flux3-klein-edit--yuki.jpg) | yuki | ✔ | ✖ ≈15–20° | ✔ | ✔ | ≈ input |

**Gate:** A passes all 16 views on 4 characters, the difficult one included. 2 of its 8 turned views mirror one one-sided detail (the hiker's bottle in ¾, Yuki's sleeve pocket in profile). In both, the turn itself is real. Identity, outfit colours and major objects (backpack, jacket, braids, sneakers) stay.

**Why the in-schema candidates failed:**
- **D (FLUX 3 Klein edit)** does not reliably turn the body. On the backpack case the three-quarter view is the front pose and the profile turns only the head. On 2 of the other 3 characters the three-quarter view turns about 15–20°.
- **C (Qwen 2511 base, no LoRA)** turns readily, but cannot hold 45°: both three-quarter views came out as profiles. It also costs about 6.6¢ and 50 s per image (33¢ and 258 s per 5-image case). Theo and Yuki were not run on C after it had failed the three-quarter view on 2 of 2 characters.
- **B** (A without the angles LoRA, Lightning only) over-rotates like C. That shows the fal LoRA is what makes the three-quarter view land at 45°.

**Things the A row also shows:**
- *Direction is not fixed.* A three-quarter view or profile shows either side of the character, whichever the LoRA picks for that image and seed. The hiker's three-quarter view and profile even face opposite ways. The app labels views "Three-quarter" and "Profile" without a side.
- *The empty-prompt baseline of A is not a no-op.* The LoRA invents a background, or even a back view (Yuki). The app always sends a view prompt. `front` is its re-render of the reference.

## Latency and cost (Cloud)

| Run | Submit → done | Cost (`balance_delta_cents`) |
| --- | --- | --- |
| A, one view (app's case), hiker ¾ | 30.0 s | 3.18¢ |
| A, 5 views in one graph (×4 characters) | 35–40 s | 3.6–4.5¢ |
| B, 5 views (×2) | 35–38 s | 3.8–3.9¢ |
| C, 5 views (×2) | 258–260 s | 32.9–33.2¢ |
| D, 5 views (×4) | 23–41 s | 2.2–2.8¢ |

Spend for this gate: 14 runs, **103.9¢** (sum of `balance_delta_cents`, `feature-coord/render-log.ndjson`). The app renders one view per generation, so a 4-view set costs about 4 × 3.2¢ ≈ 13¢ and the views render one after another (`IN_FLIGHT_MAX` 1).

## Models and licences (workflow A, `src/features/angles/workflows/models.lock`)

| File | Directory | Repository @ commit | SHA-256 | Size | Licence |
| --- | --- | --- | --- | --- | --- |
| `qwen_image_edit_2511_bf16.safetensors` | diffusion_models | Comfy-Org/Qwen-Image-Edit_ComfyUI @ `f68ace85e60b4a02a323e394253731947657b7d2` | `ae42d927…4bce08c` | 40.9 GB | Apache-2.0 |
| `qwen_2.5_vl_7b_fp8_scaled.safetensors` | text_encoders | Comfy-Org/Qwen-Image_ComfyUI @ `1f12b17be14c89b026c51a91d67c32f84bb047bc` | `cb5636d8…c5c0b4` | 9.4 GB | Apache-2.0 |
| `qwen_image_vae.safetensors` | vae | Comfy-Org/Qwen-Image_ComfyUI @ `1f12b17b…` | `a70580f0…3d1f` | 254 MB | Apache-2.0 |
| `qwen-image-edit-2511-multiple-angles-lora.safetensors` | loras | **fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA** @ `e3066224ab74263f4a5b6179cd1a3b0a15577e44` | `42426ded4e25fd22879d9e198b857556445ef4ca56e8da3246d0345155bb6765` | 295 MB | Apache-2.0 |
| `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` | loras | **lightx2v/Qwen-Image-Edit-2511-Lightning** @ `107d238d68b8387e32843d0b4a2e24ceb0d3ad86` | `22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f` | 850 MB | Apache-2.0 |

Provenance of the two LoRAs:
- Both repositories are ungated and list `license: apache-2.0` in their model-card metadata (`GET https://huggingface.co/api/models/<repo>` → `cardData.license`, read 2026-10-27). The coordinator checked the same.
- The fal card says the LoRA was trained on 3000+ Gaussian-splatting renders for 96 camera poses (8 azimuths × 4 elevations × 3 distances), with base model Qwen/Qwen-Image-Edit-2511 (Apache-2.0).
- Both files sit at their repository roots and are pinned with `directory: "loras"`, the rule Foundation added in `6192622`.
- Comfy-Org repackages only the 2509 multiple-angles LoRA (`split_files/loras/Qwen-Edit-2509-Multiple-angles.safetensors`), not the 2511 one. Its Lightning LoRAs are for Wan, not Qwen-Image-Edit-2511.

Self-host:
- **Not verified on self-host.** No pod was run.
- Node classes exist at the pin (ComfyUI 0.42.0 `object_info`).
- About 51.7 GB of weights. bf16 was measured; `qwen_image_edit_2511_int8_convrot` (Comfy-Org, 20.5 GB) would halve it, but it was not benchmarked for angles.
- Peak VRAM was not measured.

## Reproduce

```sh
C=/Users/wojciechjelen/workspace/comfy-challenge/open-photon-wt/feature-coord
node --experimental-strip-types $C/comfy-run.ts --repo $PWD --owner shots-and-angles \
  --label A-hiker --graph docs/feature-evidence/shots-and-angles/graphs/A-qwen2511-angles-lightning.multi.api.json \
  --out work/feature-evidence/shots-and-angles/runs/A-qwen2511-angles-lightning/hiker \
  --image 1=$PWD/work/feature-evidence/shots-and-angles/inputs/hiker.png
# D: --image 11=… (Klein's LoadImage); B, C: --image 1=…
```

The runtime workflow is `src/features/angles/workflows/angle-view.v1.json`: candidate A with one branch. Its prompt is set per view, and the reference and the seed are bound through `angle-view.v1.inputs.json`.
