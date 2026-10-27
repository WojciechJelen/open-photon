# Workflows

One runtime workflow, `product-shot.v1.json`: a product photo into one PNG (`image`, `SaveImage`
`9`) of the product as a packshot, a lifestyle scene or an advertising visual, entered through
`POST /api/product-shots` (`server/shoots.ts`, one generation per preset via `submitMany`).

## How it works

1. `ResizeAndPadImage` `20` fits the photo into the format's product box (`prompts.ts`, `layouts`).
2. `LoadBackgroundRemovalModel` `30` + `RemoveBackground` `31` (BiRefNet) matte it.
3. `EmptyImage` `22` (neutral grey canvas) + `ImageCompositeMasked` `21` place the matted product;
   `SolidMask` `23` + `MaskComposite` `24` place its mask on the canvas.
4. FLUX 3 Image Klein distilled (`UNETLoader` `1`, `CLIPLoader` `2`, `VAELoader` `3`) regenerates
   only the scene: `SetLatentNoiseMask` `41` with the inverse of the product mask shrunk 6 px
   (`GrowMask` `32`, `InvertMask` `33`), `ReferenceMultiLatent` `17` of the canvas (without it the
   model draws a second, larger product around the first), `KSampler` `7` 16 steps, cfg 1, euler/simple.
5. `ImageCompositeMasked` `50` pastes the photo's own pixels back (mask shrunk 2 px, `GrowMask` `34`),
   so shape, colour, logos and label text are the photo's, byte for byte up to resampling.

Built by hand from core nodes (pattern of the official `utility_birefnet_remove_background.json`
and `image_flux3_klein_distilled_image_edit.json` templates, Comfy-Org/workflow_templates @ 3c2199b)
and validated against the pinned ComfyUI 0.42.0 `/prompt` (only the expected missing model files) and
on Comfy Cloud.

## Inputs map

| Param | Node.field |
| --- | --- |
| `product_image` | `10.image` (`LoadImage`) |
| `prompt` | `4.text` (`CLIPTextEncode`), from `shotPrompt(preset, product, description)` |
| `seed` | `7.seed` (`KSampler`) |
| `width`, `height` | `22.width/height` (`EmptyImage`), `23.width/height` (`SolidMask`) |
| `box_width`, `box_height` | `20.target_width/target_height` (`ResizeAndPadImage`) |
| `box_x`, `box_y` | `24.x/y` (`MaskComposite`), `21.x/y` (`ImageCompositeMasked`) |

Formats: square 1024×1024 (box 608×736 at 208,160), portrait 896×1152 (576×864 at 160,176),
landscape 1216×832 (576×576 at 320,160).

## Recipe

`{ product_image_sha256, product, preset, description, prompt, format, canvas, seed, models, target,
workflow }` (`definition.ts`, strict). A retry draws a new seed; a re-run keeps it. Published only on
request (`publish: "on-request"`, FLUX Kommunity licence §2.e: review before distribution; every
output is labelled AI-generated).

## Models

`models.lock`: the three FLUX 3 Klein files pinned identically to `characterBuilder` (FLUX-Kommunity-1.0
/ Apache-2.0) and `background_removal/birefnet.safetensors` from Comfy-Org/BiRefNet @ 25511f87
(444,473,596 bytes, SHA-256 `9ab37426…`, MIT; coordinator-approved directory/licence). About 11.5 GB.
Peak VRAM: not measured (no self-host run in this program; "not verified on self-host").

## Measurements and evidence

Comfy Cloud: 7.9–13.1 s submit → done with a free GPU, 0.51–1.19 ¢ per shot. Cases, contact sheets,
label-crop comparisons against FLUX 3 Klein and Qwen-Image-Edit-2511 reference edits, and the
limitations (transparent and chrome products keep their photographed background and reflections;
props touching the product are kept): `docs/feature-evidence/product-studio/README.md`.

## Integration smoke (Comfy Cloud, through the app, 2026-10-27)

`npm run dev` on this worktree (`target: cloud`), lease held by hand: `POST /api/image-uploads`
(the tube photo) → `POST /api/product-shots` (lifestyle, square) → generation
`e3647130-7a96-4be9-8e9a-d0046cc29685`, Comfy job `2d73befb-1886-4c6e-af9d-1ca25099d17a`: submitted
21:34:33.7 Z, done 21:34:47.0 Z (13.3 s; 18 s request → done), `generation_outputs` `image`
1024×1024 PNG (label text intact, inspected), recipe `target: cloud`, workflow SHA-256
`e5160647…c637af`, four pins; `/g/:id` 200, published, `/r/518a1063481c9bb9` 200 without a session.
Cost not measured for this job (the app records no balance); comparable comfy-run renders 0.5–1.2 ¢.
