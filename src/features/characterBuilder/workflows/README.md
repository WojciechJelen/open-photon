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

**Gating.** `black-forest-labs/flux-3-image-klein-comfy` is gated (`gated: auto`: accepting the licence on the model page grants access at once). Without a token the Hugging Face API hides each file's `lfs.oid`, and `resolve/` answers 401 `GatedRepo`. No Hugging Face token was available when the lock was written, so the three SHA-256 values from that repository were **measured on Comfy Cloud's copies** of the same files (`GET /api/assets/:id/content`, streamed through `shasum -a 256`, 2026-10-23); Cloud imported them from `Comfy-Org/Flux-3-Image` (private), and each has exactly the byte size BFL's repository lists for the file of that name. The first self-host boot (below) downloaded all three from BFL's repository with a token, and `install-models.mjs` verified each against `models.lock` (it refuses a mismatch and the pod stops before ComfyUI starts): the pins are BFL's bytes. Self-hosting needs `HF_TOKEN` from an account that accepted the licence (see the main README).

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

**Rendered on a Runpod A40 (2026-10-23)** with the published image `ghcr.io/wojciechjelen/open-photon-comfy:0.2.0` (digest `sha256:b7d55526ea9905432f6ec78865bde685abe3f3f288899a45db21c3f630188a62`, built from `723614c`), deployed as `selfhost/runpod-template.json` describes (Secure Cloud EU-SE-1, 50 GB container disk, 80 GB volume at `/workspace`, CUDA ≥ 13.0), and the app built from `723614c` on a fresh database pointed at the pod's proxy (`target: selfhost`, no Cloud key). GPU: NVIDIA A40 46,068 MiB, driver 595.91.07, CUDA 13.2; ComfyUI 0.42.0, torch 2.10.0+cu130.

- **First boot.** Pod created 14:57:13 UTC; image pulled by 15:00:57; the nine model files downloaded from 15:01:00 to 15:06:17 (43.4 GB in 5 min 17 s), each followed by its `Verified` line, the three gated BFL files included (FLUX 3 transformer 36 s, Qwen3-VL text encoder 30 s, upsampler 45 s). Preflight: `character-caption.v1: 1 model files, 1 locked, 0 missing`, `character-generation.v1: 3 …, 0 missing`, `motion-transfer.v1: 5 …, 0 missing`, `9 distinct model files across 2 feature locks, 0 conflicts`; `Serving the Comfy API v2 on 0.0.0.0:8189 (auth: bearer)` at 15:06:28, 9 min 15 s after creation. `npm run check:comfy`: `OK: reachable and authorized`.
- **Flow through the app's API**, as the builder submits it: enhance a description (style `realistic`, an outfit), render the caption with one phrase edited (`source.caption_generation_id` set, so `edited: true`), save it as a character (201, then 200 with the same id), animate it with the Street dance sample at the default settings. `/g/<image id>`, `/r/<slug>` without a session, the library card and the Motion Transfer `/g/<id>` (both videos playing) rendered in a browser. Each was the first job of its models, so load time is included.

| Generation | Id | Submit → done | ComfyUI execution | Peak VRAM (device) | Output |
| --- | --- | --- | --- | --- | --- |
| caption | `7ac084c7-373a-4918-bc80-540e45dc1fa1` | 26.6 s | 25.37 s | 6,601 MiB | 1,158 characters |
| image, 768×1344, seed 1001 | `77508bc1-ec05-41e2-8d78-f9dcb685f4f4` | 31.9 s | 29.87 s | 10,653 MiB | PNG `484f45ac…f8d23793` |
| Motion Transfer, 480×848 | `506a2964-2050-4cde-9926-f45fdeb598a7` | 255.9 s | 254.73 s | 38,935 MiB | MP4 5.0 s, H.264 + AAC, `157b0277…f8211c6` |

Each job reached ComfyUI (`got prompt`) within 0.1 s of submission; the app took 0.5 s (caption), 0.3 s (image) and 4.3 s (Motion Transfer, uploading its inputs) from request to submission. Peak VRAM is the highest whole-device `nvidia-smi` `memory.used` sample (one per second) between each generation's submission and done. The last readings before each submission were 271, 6,229 and 9,533 MiB; within 4 s of each submission the device dropped to 271, 461 and 463 MiB before rising to its peak, so the peaks do not include models left by an earlier job. `verify-selfhost.mjs` with the three ids passed for all three: `done`, `target: selfhost`, this checkout's workflow SHA-256 and pins, the declared outputs.

- **Restart.** `runpodctl pod restart` at 15:13:39: no downloads; `install-models.mjs` re-hashed the nine files on the volume (`Verified` each, 4 min 3 s) and the API served again at 15:18:02, 4 min 23 s after the restart.
- **Cost.** 21 min 4 s from creation to termination at the pod's $0.59/h: about $0.21 (approximate; Runpod had not posted the billing record when this was written).
- **Observations.** The image shows one person head to toe, both hands and feet visible, on a plain background, as the compiled request asks. The take follows the Street dance clip's camera, which opens on a close-up and pulls back to full body in about 1.5 s. The image runs no SSH server; GPU memory was recorded through Runpod's SSH proxy (`<pod id>-<host id>@ssh.runpod.io`), which opens a shell without one.

Before the pod run, without a token (2026-10-23):

- **Graphs at the pin.** ComfyUI `7a28332` (0.42.0) on CPU, with an empty file named like each lock entry in its `models/` directory: `node scripts/check-models-lock.mjs --definitions <its object_info>` reports `character-caption.v1: 1 model files, 1 locked, 0 missing`, `character-generation.v1: 3 …, 0 missing` and `motion-transfer.v1: 5 …, 0 missing`. Each graph as its definition's `buildGraph` makes it passes ComfyUI's `/prompt` validation (no `node_errors`) and starts executing; it then stops at its first loader, on the empty file. A wrong `CLIPLoader` type or model name is refused (`prompt_outputs_failed_validation`).
- **Download.** `install-models.mjs` without `HF_TOKEN`, or with an invalid one, stops at the first FLUX 3 file with `Model download refused (HTTP 401) … Accept the FLUX Kommunity License …` and leaves no partial file; the public VAE downloads and verifies. Hugging Face's revision API answers without a token (`/api/models/black-forest-labs/flux-3-image-klein-comfy/revision/<revision>?blobs=true`) with each gated file's size and LFS SHA-256, and all three equal `models.lock`; only a download with a token proves the bytes.
- **Image.** `selfhost/Dockerfile` built for linux/amd64 (ComfyUI 0.42.0, torch 2.10.0+cu130, every feature's `workflows/`) stops on that 401 before ComfyUI starts.

To repeat the check on a pod: deploy `selfhost/runpod-template.json` (image `open-photon-comfy:0.2.0`, 80 GB volume) with `PROXY_TOKEN` and `HF_TOKEN` (an account that accepted the FLUX Kommunity License). The boot log must show `Verified` for the nine files and the three `… 0 missing` preflight lines. Record GPU memory from before the first submission with `TZ=UTC nvidia-smi --id=0 --query-gpu=timestamp,name,memory.used --format=csv,noheader,nounits -l 1 > gpu.csv`, then, with the app pointed at the pod, enhance a caption, render an image from it, save it as a character and animate it once, and check the three generations with `BASE_URL=… ACCESS_CODE=… VRAM_CSV=gpu.csv node scripts/verify-selfhost.mjs <caption id> <image id> <Motion Transfer id>` (it reports each one's peak VRAM and latency).
