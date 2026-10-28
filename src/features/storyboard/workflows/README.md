# Workflows

A storyboard runs two kinds of generations, both through the shared generation service:

| Generation | Workflow | What it does | Output |
| --- | --- | --- | --- |
| Scene split (one per storyboard, unless the user writes the scenes) | `storyboard-scenes.v1.json` (this feature) | Qwen3.5 4B, through core `TextGenerate`, splits the user's sequence into four `Scene N:` lines | text `scenes` (`SaveText` `4`), read by `parseScenes` (`../contracts.ts`) |
| Card image (one per card render) | `image-edit` v1 (`src/features/imageEdit/`, the shared reference-image edit) | FLUX 3 Image Klein distilled edits the storyboard's character (the one reference) into the card's scene | image `image` |

The card graph is not copied here: a card is an `imageEdit` input `{ prompt: compileCardPrompt(description, style), references: [{ character_id }], seed, width: 1344, height: 768 }`, sent through `submitMany` (one item per card asked for).

## `storyboard-scenes.v1.json`

Adapted from Comfy's official template `templates/llm_qwen3_5_text_gen.json` (Comfy-Org/workflow_templates @ `3c2199b`, 2026-10-26; MIT): the template's `CLIPLoader` `1` and `TextGenerate` `3` with its sampling settings, its `LoadImage` `2` dropped (the split reads no image), and its `PreviewAny` `4` replaced by core `SaveText` `4`, since Comfy's jobs API lists no output for a `PreviewAny` (`characterBuilder/workflows/README.md`).

| Node | Class | Inputs |
| --- | --- | --- |
| `1` | `CLIPLoader` | `qwen3.5_4b_bf16.safetensors`, `type: stable_diffusion`, `device: default` (the template's) |
| `3` | `TextGenerate` | `prompt` = the sequence (trimmed, byte for byte); `max_length: 1024`; `sampling_mode: on` with the template's `temperature 0.7`, `top_k 64`, `top_p 0.95`, `min_p 0.05`, `repetition_penalty 1.05`, `presence_penalty 0`, `seed`; `thinking: false`, `use_default_template: true`, `mtp: off`; `system_prompt` = the storyboard writer's instructions (below) |
| `4` | `SaveText` | `text` ← `3`, `filename_prefix: storyboard_scenes`, `format: txt` |

The system prompt asks for exactly four consecutive scenes of 20–50 words, each self-contained (action, setting with props, time of day and light, camera framing), the character called only "the character" and never described (the reference image supplies the face, hair and outfit), continuity of setting between scenes, no captions or text, and the answer as four `Scene N: …` lines, with one worked example. `parseScenes` accepts exactly those four numbered scenes (on separate lines or run together) and refuses anything else: a refused answer is shown as a failed split, never repaired.

The template's `max_length` (256) is raised to 1024 so four scenes always fit; everything else is the template's. The recipe records the loader's and `TextGenerate`'s literal inputs (`text_model`), so it states exactly what was sent.

### Inputs map

| Param | Node.field |
| --- | --- |
| `request` | `3.prompt` (`TextGenerate`) |
| `seed` | `3.sampling_mode.seed` (`TextGenerate`) |

## Models

[`models.lock`](models.lock):

| File | Directory | Bytes | SHA-256 | Licence | Source |
| --- | --- | --- | --- | --- | --- |
| `qwen3.5_4b_bf16.safetensors` | `text_encoders` | 9,319,828,320 | `9fb3ae42…8050841` | Apache-2.0 | `Comfy-Org/Qwen3.5` @ `5d50a22` (repackaged `Qwen/Qwen3.5-4B`) |

Size, SHA-256 (`lfs.oid`) and licence (`cardData.license: apache-2.0`) are the Hugging Face API's for that commit. Comfy Cloud lists the file in `CLIPLoader.clip_name`. Every node class is core (`nodes`, `comfy_extras.nodes_textgen`, `nodes_text`) and exists at the self-host pin `7a28332` (ComfyUI 0.42.0, whose `comfy/sd.py` loads Qwen3.5 2B–27B text models) and on Cloud.

**Why not the FLUX 3 prompt upsampler** (`qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors`, already pinned by `characterBuilder`): with the same task as its system prompt it ignored the format and the "never describe the character" rule on all three test sequences (it invented other hair and outfits, and added caption text); evidence in `docs/feature-evidence/storyboard/README.md`.

## Measurements

Comfy Cloud, 2026-10-27, through `feature-coord/comfy-run.ts` (this repository's SDK provider). Per split: 5.4–18.0 s submit → done (most of it Cloud queueing), 0.25–0.82 ¢. Cards (Klein edit, 1344×768): 7.9–29.7 s, 0.52–0.91 ¢. Cases and outputs: `docs/feature-evidence/storyboard/`.

Self-host: not verified (no pod in this program). The 9.3 GB text model adds to every pod's download and disk (the aggregate of every lock); its peak VRAM is not measured.
