# Workflows

Two runtime workflows make a character with **FLUX 3 Image Klein** (distilled), Black Forest Labs' open-weights image model, in ComfyUI:

| Workflow | What it does | Entry | Output |
| --- | --- | --- | --- |
| `character-caption.v1.json` | FLUX 3's prompt upsampler expands a description (and its controls) into one full caption | `POST /api/character-captions` (`server/generate.ts`, `caption-definition.ts`) | text `caption` (`SaveText` `18:13`) |
| `character-generation.v1.json` | the distilled transformer renders a caption, byte for byte, into one PNG; it never runs the upsampler | `POST /api/character-generations` (`definition.ts`) | image `image` (`SaveImage` `9`) |

Saving the image as a library character is a separate, explicit request: `POST /api/character-generations/:generationId/character`.

BFL's card: "Do not use the model without a prompt upsampler … a short prompt sent as typed gives generic output." The app therefore enhances first, lets the user edit the caption, and renders exactly what the user accepted. A caption written by hand can also be rendered directly (no enhancement provenance then).

## Origin

Both graphs are adapted from Comfy's official template `templates/image_flux3_klein_distilled_t2i.json` in [Comfy-Org/workflow_templates@369c1ed](https://github.com/Comfy-Org/workflow_templates/blob/369c1ed12496587bbce50a7797ca342da170e5f7/templates/image_flux3_klein_distilled_t2i.json) (2026-10-17, "FLUX 3 Klein: stop the prompt upsampler seed following the image seed", the last commit touching it; `main` served the same bytes on 2026-10-23, SHA-256 `253fa4e783da734acd03b804a8731d0a7a8c564b73961837762800eb5cf85388`). The template is UI format (frontend 1.55.17). The upstream repository is MIT licensed; see [`LICENSE.upstream`](LICENSE.upstream).

The template has one subgraph instance, node `18` "Text to Image (FLUX 3 Image Klein SD)", wired to `SaveImage` `9`. Inside it, a `ComfySwitchNode` (`16`, "enable_prompt_upsampler") picks either the raw prompt or the upsampler's text (`CLIPLoader` `12` → `TextGenerate` `11`, system prompt from `PrimitiveStringMultiline` `14`, shown by `PreviewAny` `13`) and feeds it to the image path. The app splits that into two graphs, so the user sees and may edit the caption between them. Node ids keep the subgraph prefix the frontend's API export gives them (`18:<inner id>`); `SaveImage` keeps `9`. Top-level `ResolutionSelector` `19`, `CreateBoundingBoxes` `23`, `PreviewAny` `24`, `Flux3LayoutPrompt` `25` (bounding boxes) and the `MarkdownNote`s are dropped.

Values bound from the subgraph instance's widgets: `steps` 16, `sampler_name` `euler`, `scheduler` `simple` (the inner `KSampler`'s own `15`, `er_sde` are overridden by those links), seed and size; model files `flux3-image-klein-int8-convrot.safetensors`, `qwen3vl_4b_int8_convrot.safetensors`, `flux2-vae.safetensors`, `qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors`.

### `character-generation.v1.json` (no upsampler)

| Node | Class | Inputs |
| --- | --- | --- |
| `18:1` | `UNETLoader` | `flux3-image-klein-int8-convrot.safetensors`, `weight_dtype: default` |
| `18:2` | `CLIPLoader` | `qwen3vl_4b_int8_convrot.safetensors`, `type: flux3`, `device: default` |
| `18:3` | `VAELoader` | `flux2-vae.safetensors` |
| `18:4` | `CLIPTextEncode` | `text` = the caption (in the template: the switch's output via `PreviewAny`), `clip` ← `18:2` |
| `18:5` | `CLIPTextEncode` | `text: ""` (negative), `clip` ← `18:2` |
| `18:6` | `EmptyFlux2LatentImage` | `width`, `height`, `batch_size: 1` |
| `18:7` | `KSampler` | `seed`, `steps: 16`, `cfg: 1`, `euler`, `simple`, `denoise: 1` |
| `18:8` | `VAEDecode` | ← `18:7`, `18:3` |
| `9` | `SaveImage` | `filename_prefix: image_flux3_klein_distilled_t2i`, images ← `18:8` |

The switch, the upsampler nodes and `PreviewAny` are removed; the caption is inlined into `18:4.text`. 16 steps and CFG 1 are the distilled checkpoint's defaults (BFL's card: "16 steps and no guidance for the distilled checkpoint").

### `character-caption.v1.json` (upsampler only)

| Node | Class | Inputs |
| --- | --- | --- |
| `18:12` | `CLIPLoader` | `qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors`, `type: flux3`, `device: default` |
| `18:14` | `PrimitiveStringMultiline` | `value` = the template's system prompt, verbatim (3,405 characters) |
| `18:11` | `TextGenerate` | `prompt` = the compiled request, `max_length: 3584`, `sampling_mode: on` with `temperature 1`, `top_k 1`, `top_p 0.95`, `min_p 0`, `repetition_penalty 1.05`, `presence_penalty 1.5`, `seed`; `thinking: false`, `use_default_template: true`, `mtp: off`, `system_prompt` ← `18:14` |
| `18:13` | `SaveText` | `text` ← `18:11`, `filename_prefix: character_caption`, `format: txt` |

The template's `PreviewAny` is replaced by core `SaveText` (`comfy_extras/nodes_text.py`): Comfy API v2 lists no output for a `PreviewAny` (Cloud job `bfadd9f9-bd3d-46e2-87aa-13507a7c6472` answered `outputs: []`; comfy-api-proxy 0.1.6 drops text items too), while a `SaveText` file is a regular `file` output (job `4d271516-4dae-413e-a556-c1fcd941784c`: `character_caption_00001.txt`, 1,190 bytes, the same text). The `TextGenerate` settings are the template's (`widgets_values_named`). In API format a DynamicCombo's sub-inputs are dotted keys (`sampling_mode.temperature`, …), as ComfyUI's `comfy_api/latest/_io.py` builds them. Sampling is on, but with `top_k 1` only the most likely token survives at each step, so the draw is effectively greedy: the same request gives the same caption and the seed, though recorded, does not change it (two Cloud runs of one request, jobs `bfadd9f9-…` and `4d271516-…`, produced the same 1,190 bytes; both used seed 1, so this rests on `top_k 1`, not on a seed comparison). BFL's upsampler card describes its own decoding differently ("Decoding: greedy, top_p 0.95, top_k 20, presence penalty 1.5 for text-to-image"); the workflow follows Comfy's template, not the card.

## Inputs maps

| Param | Node.field |
| --- | --- |
| `caption` | `18:4.text` (`CLIPTextEncode`) |
| `seed` | `18:7.seed` (`KSampler`) |
| `width`, `height` | `18:6.width/height` (`EmptyFlux2LatentImage`) |
| caption workflow: `request` | `18:11.prompt` (`TextGenerate`) |
| caption workflow: `seed` | `18:11.sampling_mode.seed` (`TextGenerate`) |

## Recipes

**Caption** (`caption-definition.ts`): `{ request, description, controls, seed, upsampler: { model, system_prompt, settings }, models, target, workflow }`. `request` is `compileCharacterRequest(description, controls)` (`../contracts.ts`), computed by the server; `controls` keeps only the given ones (`null` for none). `upsampler` is read from the workflow file itself, so the recipe states exactly what was sent.

**Image** (`definition.ts`): `{ caption, seed, width, height, source: { description, controls, enhancement }, models, target, workflow }`. `caption` is stored and sent byte for byte (no trim). With `source.caption_generation_id` the server copies the description, controls and `enhancement: { generation_id, caption, edited, model, system_prompt_sha256, settings }` from that `done` caption generation (404 `caption_not_found`, 409 `not_caption`, 409 `caption_not_done` otherwise) and ignores the client's description and controls; `edited` is `caption !== enhancement.caption`. Without it, `source` is the client's `description`/`controls` (or `null`) and `enhancement: null`. A re-run keeps the recipe; a retry changes only the seed; both keep caption and source. A saved character's `prompt` is the caption.

[`defaults.json`](defaults.json) holds the size a request without one renders at: 768×1344 (see Measurements). A request without a seed gets a random one, resolved once into the recipe; a client that may repeat a request sends a `request_key`.

## Models

[`models.lock`](models.lock), one lock for both workflows:

| File | Directory | Bytes | SHA-256 | Licence | Source |
| --- | --- | --- | --- | --- | --- |
| `flux3-image-klein-int8-convrot.safetensors` | `diffusion_models` | 5,827,874,779 | `847d8933…2e168fe2` | FLUX Kommunity License v1.0 | `black-forest-labs/flux-3-image-klein-comfy` @ `feef60b` |
| `qwen3vl_4b_int8_convrot.safetensors` | `text_encoders` | 4,858,559,240 | `32de113c…bf4ee01c` | Apache-2.0 | same |
| `qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors` | `text_encoders` | 6,724,090,780 | `e5d85a74…194a4458` | Apache-2.0 | same |
| `flux2-vae.safetensors` | `vae` | 336,211,292 | `868fe7b3…0ce8f3` | Apache-2.0 | `Comfy-Org/Flux-2-Klein-4B` @ `533c4cb` (`split_files/vae/`) |

About 17.7 GB in total.

**Licences.** BFL's card: the transformer is under the [FLUX Kommunity License v1.0](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/blob/main/LICENSE.md). §2.a(i) grants non-commercial use; §2.a(ii) lets a Qualifying User (with affiliates, under US$5M gross annualized revenue) use outputs commercially and run the model in production solely to generate them; §2.e conditions that on (i) content filters, or review of outputs before distribution, and (ii) disclosure that outputs were AI-generated *to the extent required under applicable law*; §3 requires the licence and its attribution notice when the weights are redistributed. Open Photon implements no content filter and no disclosure; a deployment that relies on §2.a(ii) has to provide them. It is **not** an OSI licence, and the app does not relabel it: the lock and every recipe say `FLUX-Kommunity-1.0`. "The Qwen3-VL-4B-Instruct text encoder is under Apache-2.0. The prompt upsampler is under Apache-2.0." The VAE pin is the Apache-2.0 file of FLUX.2 [klein] 4B: Comfy Cloud's `flux2-vae.safetensors`, which FLUX 3 runs with, hashes to exactly that file's SHA-256 (`868fe7b3…`, measured by streaming it; it was FLUX.2's pin before), and BFL's card says FLUX 3's autoencoder is the original repository's `ae.safetensors`, with the same byte size.

**Gating.** `black-forest-labs/flux-3-image-klein-comfy` is gated (`gated: auto`: accepting the licence on the model page grants access at once). Without a token the Hugging Face API hides each file's `lfs.oid`, and `resolve/` answers 401 `GatedRepo`. No Hugging Face token was available here, so the three SHA-256 values from that repository were **measured on Comfy Cloud's copies** of the same files (`GET /api/assets/:id/content`, streamed through `shasum -a 256`, 2026-10-23); Cloud imported them from `Comfy-Org/Flux-3-Image` (private), and each has exactly the byte size BFL's repository lists for the file of that name. That they equal BFL's LFS object ids is an inference, not a check: the first self-host download verifies it (`install-models.mjs` refuses a mismatch and the pod stops before ComfyUI starts). Self-hosting needs `HF_TOKEN` from an account that accepted the licence (see the main README).

**int8, not bf16.** The int8 transformer and text encoder are the template's choice ("ships the quantised distilled checkpoint to keep the footprint small. With more than 24 GB of VRAM, use the bf16 weights"), run "on 8 GB GPUs such as the RTX 3070" (BFL's card), and are the only distilled FLUX 3 files Comfy Cloud offers under BFL's names (Cloud's bf16 copies are named `flux3_image_klein_sd_bf16.safetensors`, a name BFL's repository does not have). The w4a8 upsampler is the template's (BFL's own workflows default to the int8 one, 9.7 GB).

**Comfy Cloud.** Cloud's `object_info` loader lists do not include these four files (`node scripts/check-models-lock.mjs --definitions <Cloud object_info>` reports them missing), but Cloud's model asset library has them and jobs that load them succeed (below); the preflight against object_info applies to self-host, where the loaders list what `install-models.mjs` placed. Every node class is ComfyUI core (`nodes`, `comfy_extras.nodes_flux`, `nodes_textgen`, `nodes_text`, `nodes_primitive`), none is an API node, and all exist in Cloud's `object_info` (ComfyUI 0.42.5) and at the self-host pin `7a28332` (ComfyUI 0.42.0 ≥ the 0.41.0 FLUX 3 needs).

## Measurements (Comfy Cloud, 2026-10-23)

Direct submissions of the committed graphs (`comfy.submit`, one at a time). Cost is the account's `effective_balance_cents` before submit and 30 s after done; billing granularity is undocumented, so single-job deltas are approximate. VRAM is not observable on Cloud.

| Graph | Job | Submit → done | Queue | Execution | Balance Δ |
| --- | --- | --- | --- | --- | --- |
| caption (`PreviewAny`, before the switch to `SaveText`) | `bfadd9f9-bd3d-46e2-87aa-13507a7c6472` | 10.1 s | 1.8 s | 5.6 s | 0.575 ¢ |
| caption (`SaveText`) | `4d271516-4dae-413e-a556-c1fcd941784c` | 5.0 s | 1.7 s | 1.1 s | 0.080 ¢ |
| image 768×1344, seed 1001 | `1dd0543e-21da-4166-82c3-641c7182df70` | 14.3 s | 2.2 s | 7.2 s | 0.835 ¢ |

Runs through the app and with Motion Transfer: the PR's evidence.

**Default size.** Motion Transfer resizes the reference to its render size (480×848 portrait) with a centre crop. 768×1344 (aspect 0.571, about 1 MP, multiples of 16) loses about 9 px of width to that crop, and the first FLUX 3 render at that size shows one person from the top of the head to the soles with both hands and feet in frame on a plain background; it stays the default.

## Self-host

**Not verified on self-host**: no pod credentials were available. Known: every class exists at the pinned ComfyUI source; the lock aggregates with Motion Transfer's without a conflict (`npm run check:models`). To verify: build `selfhost/Dockerfile`, start a pod with `PROXY_TOKEN` and `HF_TOKEN` (an account that accepted the FLUX Kommunity License) and room for about 17.7 GB more weights; the boot log must show `Verified` for the four files and `characterBuilder/character-generation.v1: 3 model files, 3 locked, 0 missing` from the preflight. Then run a caption, an image and a save through the app pointed at the pod, record peak VRAM with `nvidia-smi`, and animate the character once.
