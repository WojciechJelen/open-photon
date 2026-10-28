# Shots & Angles workflow

`angle-view.v1.json` renders one camera angle of a reference image. It is the subgraph "Image Edit (Qwen-Image 2511 with LoRA)" of the official templates `template_qwen_multiangle.app.json` and `templates-1_click_multiple_character_angles-v1.0.json` (Comfy-Org/workflow_templates `3c2199b`), flattened by hand to API format with the Lightning switch on:

- `LoadImage` `1` → `FluxKontextImageScale` `160` → `TextEncodeQwenImageEditPlus` `151` (positive, the view's prompt) and `149` (negative, empty), each with `FluxKontextMultiReferenceLatentMethod` `index_timestep_zero`. `VAEEncode` `156` of the scaled image is the latent.
- `UNETLoader` `161` (`qwen_image_edit_2511_bf16`) → `LoraLoaderModelOnly` `220` (fal Multiple-Angles, strength 1) → `ModelSamplingAuraFlow` `145` (shift 3.1) → `CFGNorm` `152` (1) → `LoraLoaderModelOnly` `153` (lightx2v Lightning 4-step, strength 1).
- `KSampler` `169` (4 steps, cfg 1, euler, simple) → `VAEDecode` `158` → `SaveImage` `2`, the output `image`.

The inputs (`angle-view.v1.inputs.json`) are:

- `reference_image`, bound to `1.image`: the library character's image, uploaded by SHA-256.
- `prompt`, bound to `151.prompt`. It is the view's phrase in the LoRA's vocabulary, `VIEW_PROMPTS` in `definition.ts`:

  | View | Prompt |
  | --- | --- |
  | front | `<sks> front view eye-level shot medium shot` |
  | three-quarter | `<sks> front-right quarter view eye-level shot medium shot` |
  | profile | `<sks> right side view eye-level shot medium shot` |
  | close-up | `<sks> front view eye-level shot close-up` |

- `seed`, bound to `169.seed`.

Both LoRAs come from outside Comfy-Org. The coordinator approved them by repository id, and `models-lock.ts` accepts exactly these two repositories:

- `fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA` @ `e3066224…`
- `lightx2v/Qwen-Image-Edit-2511-Lightning` @ `107d238d…`

Both are Apache-2.0 and ungated. `models.lock` pins every file.

The ComfyUI gate, with per-view verdicts, the candidates that failed, latency (about 30 s and 3.2¢ a view on Comfy Cloud) and licences, is in [`docs/feature-evidence/shots-and-angles/`](../../../../docs/feature-evidence/shots-and-angles/README.md).

Self-host:

- Not verified on self-host. No pod was run.
- The node classes exist at the pin (0.42.0).
- The weights are about 51.7 GB.
- Peak VRAM was not measured.
