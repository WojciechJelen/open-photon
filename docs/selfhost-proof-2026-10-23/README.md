# Self-host proof, 2026-10-23

Raw evidence for the self-host run summarised in the Self-host section of [the character workflows README](../../src/features/characterBuilder/workflows/README.md#self-host): the FLUX 3 caption and image workflows and Motion Transfer rendered on a Runpod A40 from the published image, then checked with `scripts/verify-selfhost.mjs`.

## Setup

- **Code:** app and image both built from `723614c`.
- **Image:** `ghcr.io/wojciechjelen/open-photon-comfy:0.2.0`, digest `sha256:b7d55526ea9905432f6ec78865bde685abe3f3f288899a45db21c3f630188a62` (the `Digest:` lines in `boot.log`).
- **Pod:** deployed as `selfhost/runpod-template.json` describes (Secure Cloud EU-SE-1, 50 GB container disk, 80 GB volume at `/workspace`).
- **GPU:** NVIDIA A40 46,068 MiB, driver 595.91.07, CUDA 13.2, as `nvidia-smi` reported on the pod (its header was not saved; `gpu.csv` holds the per-second memory samples). ComfyUI reports `Device: cuda:0 NVIDIA A40`, `Total VRAM 45490 MB`, `pytorch version: 2.10.0+cu130`, `ComfyUI version: 0.42.0` (`boot.log`).
- **App:** fresh database, `target: selfhost`, no Cloud key, pointed at the pod's proxy.

## Boot

Pod created 14:57:13 UTC. The image was pulled by 15:00:57 and the container started at 15:00:59. From 15:01:00 to 15:06:17, `install-models.mjs` downloaded the nine model files (43.4 GB in 5 min 17 s), and each was followed by its `Verified` line:

```text
15:01:36 Verified flux3-image-klein-int8-convrot.safetensors
15:02:07 Verified qwen3vl_4b_int8_convrot.safetensors
15:02:52 Verified qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors
15:02:54 Verified flux2-vae.safetensors
15:02:56 Verified Wan2_1_VAE_bf16.safetensors
15:03:03 Verified clip_vision_h.safetensors
15:03:09 Verified lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors
15:03:59 Verified umt5_xxl_fp8_e4m3fn_scaled.safetensors
15:06:16 Verified wan_animate_2_int8_convrot.safetensors
```

Preflight at 15:06:27:

```text
characterBuilder/character-caption.v1: 1 model files, 1 locked, 0 missing (Apache-2.0)
characterBuilder/character-generation.v1: 3 model files, 3 locked, 0 missing (Apache-2.0, FLUX-Kommunity-1.0)
motionTransfer/motion-transfer.v1: 5 model files, 5 locked, 0 missing (Apache-2.0)
9 distinct model files across 2 feature locks, 0 conflicts
```

The pod logged `Serving the Comfy API v2 on 0.0.0.0:8189 (auth: bearer)` at 15:06:27 and `Running on` at 15:06:28, 9 min 15 s after it was created.

## Generations

The run went through the app's API in the same order as the builder: enhance a description (style `realistic`, an outfit), render the caption with one phrase edited (`bright` inserted before `mustard yellow rain jacket`; `source.caption_generation_id` set, so `edited: true`), save the image as a character, and animate it with the Street dance sample at the default settings. Each job was the first to use its models, so the timings include model loading.

| Generation | Id | Submit → done | ComfyUI execution | Peak VRAM (device) | Output |
| --- | --- | --- | --- | --- | --- |
| caption | `7ac084c7-373a-4918-bc80-540e45dc1fa1` | 26.6 s | 25.37 s | 6,601 MiB | `caption.txt`, 1,158 characters, SHA-256 `a9d5ea55…1888e4c` |
| image, 768×1344, seed 1001 | `77508bc1-ec05-41e2-8d78-f9dcb685f4f4` | 31.9 s | 29.87 s | 10,653 MiB | `image.png`, SHA-256 `484f45ac…f8d23793` |
| Motion Transfer, 480×848 | `506a2964-2050-4cde-9926-f45fdeb598a7` | 255.9 s | 254.73 s | 38,935 MiB | `motion-transfer.mp4`, 5.0 s, H.264 + AAC, SHA-256 `157b0277…f8211c6` |

Peak VRAM is the highest whole-device `nvidia-smi` `memory.used` sample (one per second) between each generation's submission and done. The last readings before each submission were 271, 6,229 and 9,533 MiB; within 4 s of each submission the device dropped to 271, 461 and 463 MiB before rising to its peak, so the peaks do not include models left by an earlier job.

`verify-selfhost.mjs` passed for all three ids. It checked that each one was `done` with `target: selfhost`, matched this checkout's workflow SHA-256 and model pins, and had the outputs its workflow declares (`verify.txt`). The recipes are exported verbatim from the app database's `generations.recipe` column (`*.recipe.json`). The image recipe's `source.enhancement` names the caption generation and the SHA-256 of the system prompt, which is stored in full in `caption.recipe.json`.

## Restart and cost

- **Restart.** The pod was restarted with `runpodctl pod restart` at 15:13:39 and downloaded nothing. `install-models.mjs` re-hashed the nine files on the volume (`Verified` for each, 4 min 3 s), and the preflight lines matched the first boot. The API was serving again at 15:18:02, 4 min 23 s after the restart (`boot.log`).
- **Cost.** 21 min 4 s from creation to termination at the pod's $0.59/h: about $0.21 (approximate; Runpod had not posted the billing record when this was written).

## Files

| File | Contents |
| --- | --- |
| `verify.txt` | Output of `verify-selfhost.mjs` for the three ids. |
| `gpu.csv` | `TZ=UTC nvidia-smi --id=0 --query-gpu=timestamp,name,memory.used --format=csv,noheader,nounits -l 1`, 15:07:14 to 15:13:17 (columns: timestamp, GPU, MiB used). |
| `boot.log` | The pod log trimmed to the image pull and start, model `Downloading`/`Verified` lines, ComfyUI version, preflight, `Serving`, each job's `got prompt`/`Prompt executed`, and the restart. Layer progress, other ComfyUI output and the container id were removed. |
| `caption.recipe.json`, `image.recipe.json`, `motion-transfer.recipe.json` | The three generations' stored recipes. |
| `caption.txt`, `image.png`, `motion-transfer.mp4` | The three outputs, byte-identical to the app's assets (the SHA-256 values above). |

## Reproduce

1. Deploy `selfhost/runpod-template.json` (image `open-photon-comfy:0.2.0`, 80 GB volume) with the proxy bearer token and a Hugging Face token set as the template's environment describes (see "Choose a rendering backend" in the [main README](../../README.md#choose-a-rendering-backend)). The Hugging Face account must have accepted the FLUX Kommunity License.
2. Check that the boot log shows `Verified` for all nine files and the three `… 0 missing` preflight lines.
3. Before the first submission, start recording GPU memory on the pod with `TZ=UTC nvidia-smi --id=0 --query-gpu=timestamp,name,memory.used --format=csv,noheader,nounits -l 1 > gpu.csv`.
4. With the app pointed at the pod, enhance a caption, render an image from it, save the image as a character and animate it once.
5. Run `BASE_URL=… ACCESS_CODE=… VRAM_CSV=gpu.csv node scripts/verify-selfhost.mjs <caption id> <image id> <Motion Transfer id>` ([script](../../scripts/verify-selfhost.mjs)). It reports each generation's latency and peak VRAM, and writes `work/selfhost-<id>.{json,mp4,png}`.
