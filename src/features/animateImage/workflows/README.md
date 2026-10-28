# Animate Image workflow

`animate-image.v1.json`: one still image and a description of an action into a 5 s video
(81 frames at 16 fps, H.264 MP4) with Wan 2.2 14B image-to-video, no driving clip. The gate,
its cases, frames, latency and cost: [`docs/feature-evidence/animate-image/`](../../../../docs/feature-evidence/animate-image/README.md).

## Provenance

- Template `video_wan2_2_14B_i2v.json` of Comfy-Org/workflow_templates @ `3c2199b`, its
  "Image to Video (Wan2.2)" subgraph flattened by hand to API format with "Enable 4steps LoRA?"
  on: the switch, primitive and math nodes are inlined as literals (4 steps, cfg 1, split at
  step 2, 16 fps, length `floor(5 × 16 + 1)` = 81). The graph is the evidence's
  `graphs/wan22-i2v-14b-4step.api.json` with neutral values in the bound fields.
- Every class is core and exists at the pin (ComfyUI 0.42.0, `7a28332`) and on Comfy Cloud.
- Bound fields (`animate-image.v1.inputs.json`): `image` → `LoadImage` `1.image` (the source,
  uploaded by content), `prompt` → `4.text`, `seed` → `13.noise_seed` (the high-noise sampler
  adds the noise; the low-noise one continues without), `width`/`height` → `WanImageToVideo`
  `6.width`/`6.height`. The negative prompt is the template's.
- Output: `SaveVideo` `17` declared as the `video` output with `poster: true` (the shared
  finalize cuts the still at 0.5 s).

## Definition (`definition.ts`)

- Input `animateImageInputSchema`: `source` (an uploaded image asset, a done generation's image
  output, or a library character), `prompt` (1–1000 characters, the action), optional `seed`.
- `prepareRecipe` reads the source through the shared stores (never writes them) and refuses 404
  `source_not_found`, 409 `source_not_done`, 422 `source_not_image` or `consent_required`; it
  stores the image by SHA-256 with its size, the size the video renders at (`videoSize`: about
  640×640 pixels in the image's aspect, clamped to 9:16…16:9, sides multiples of 16), the prompt
  and the seed (a random one, drawn once, when the request has none). A character source records
  `generations.character_id`.
- `publish: "on-request"`: a done video stays private until its owner publishes it from
  `/animate` ("Publish & copy link"): the source may be someone's uploaded likeness or a FLUX
  image, whose licence asks for outputs to be reviewed before they are distributed.
  `shareRecipe` shows only the source's kind on the public page.

## Models (`models.lock`)

Five files from `Comfy-Org/Wan-2.2` @ `ee6f4a40737a995bf5818954cfce6d59443b0f04` (the template's
`Comfy-Org/Wan_2.2_ComfyUI_Repackaged` redirects there): both 14B i2v experts (fp8 scaled), both
lightx2v 4-step LoRAs and `wan_2.1_vae.safetensors`; and `umt5_xxl_fp8_e4m3fn_scaled.safetensors`
pinned exactly as Motion Transfer pins it (`Comfy-Org/Wan-Animate-2` @ `e7181fe`, the same
SHA-256), so the aggregate lock has one pin for it. All Apache-2.0 (model cards of
`Comfy-Org/Wan-2.2`, `Wan-AI/Wan2.2-I2V-A14B`, `lightx2v/Wan2.2-Lightning`). Weights new to a
self-host pod: 31.3 GB (14,294,742,832 × 2 + 1,226,977,424 × 2 + 253,815,318 bytes). Peak VRAM:
not measured (the template quotes 83–84 % of a 24 GB card at 640×640 with fp8 weights).

## Cost and latency (Comfy Cloud, measured)

2.97–4.11 ¢ and 27–36 s from submit to done per 5 s clip (seven gate renders through
`comfy-run.ts`); 3.00 ¢ and 30.2 s for the app smoke below.

## Integration smoke (Comfy Cloud, through the app)

2026-10-27, dev server on Cloud, render lease held by hand: an uploaded dog image animated from
`/animate` (generation `8e44a192-b33d-4b7b-85d6-166ec3ad528e`): `done`, recipe `target: cloud`,
`generation_outputs` `video` (848×480, 5.06 s, H.264) and `poster`; `/g/:id` 200; published from
the page, `/r/bb5aa06c84acd17b` 200 without a session, with `og:video`. Details and screens:
the evidence README, "App smoke".

## Not verified

- Self-host: not verified on self-host (no pod in this program); VRAM not measured.
