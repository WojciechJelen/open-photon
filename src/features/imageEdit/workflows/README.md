# Workflows

Two runtime workflows edit 1–3 reference images by a prompt with **FLUX 3 Image Klein** (distilled), Black Forest Labs' open-weights image model, in ComfyUI. They are the shared reference-image edit other features submit through the generation service (`../api.ts`); this feature owns no route, table or UI.

| Workflow | What it does | Definition | Outputs |
| --- | --- | --- | --- |
| `image-edit.v1.json` | the distilled transformer edits the references by the prompt as given | `imageEditDefinition` (`definition.ts`) | image `image` (`SaveImage` `9`) |
| `image-edit-enhanced.v1.json` | FLUX 3's prompt upsampler first rewrites the prompt from the prompt and the references (the template's edit system prompt), then the same edit renders that text | `imageEditEnhancedDefinition` | image `image` (`9`), private text `caption` (`SaveText` `53`) |

`imageEditDefinitionFor(input)` picks one by `input.enhance`. Which one to use, measured by the bake-off (`docs/feature-evidence/image-edit/BAKEOFF.md`): the direct edit keeps identity best and is the cheapest; Klein copies the reference's pose and gesture unless the prompt is explicit, garbles text in the image, and does not guarantee a strict 90° profile. The enhanced edit makes pose changes (walking) and in-image text work, and turns profiles back toward the camera more often.

## Origin

Adapted from Comfy's official template `templates/image_flux3_klein_distilled_image_edit.json` in Comfy-Org/workflow_templates@`3c2199b9362457b12b9c60c6cc303501526ebd62` (2026-10-26; MIT, as `../../characterBuilder/workflows/LICENSE.upstream`). The template (UI format) was converted to API format with the pinned frontend (ComfyUI 0.42.0 at the shared CPU editor, `app.loadGraphData(template)` then `app.graphToPrompt().output`), and trimmed to the edit path; the trimmed graphs ran on Comfy Cloud in the bake-off (`docs/feature-evidence/image-edit/graphs/flux3-klein-edit*.api.json`). Node ids are the export's.

**Flattening.** Removed: `ImageCompare` `18`, `CreateBoundingBoxes` `33` and `Flux3LayoutPrompt` `49` (the bounding-box layout prompt), both `PreviewAny` (`34`, `52`) and the `ComfySwitchNode` `51` that picks the raw or upsampled prompt. The switch is inlined per workflow: the direct one binds the prompt to `CLIPTextEncode` `4.text`; the enhanced one links `4.text` to `TextGenerate` `47` and binds the prompt to `47.prompt`. The upsampler's text is saved by core `SaveText` `53` (`format: txt`): Comfy's jobs API lists a `SaveText` file, not a `PreviewAny` text (`../../characterBuilder/workflows/README.md`). The template's unused `EmptyFlux2LatentImage` `44` is wired to `KSampler` `7.latent_image` and sets the output size; `ReferenceMultiLatent` `17`'s own `empty_latent` (output 2: the first reference's aspect at about 1 MP) is no longer used, so the size is in the recipe whether the request gave one or not (see Recipes). Three `LoadImage` slots (`11`, `12`, `13` → `17.images.image0..2`, and in the enhanced graph `BatchImagesNode` `50.images.image0..2`, which shows the upsampler the same images).

| Node | Class | Inputs |
| --- | --- | --- |
| `1` | `UNETLoader` | `flux3-image-klein-int8-convrot.safetensors`, `weight_dtype: default` |
| `2` | `CLIPLoader` | `qwen3vl_4b_int8_convrot.safetensors`, `type: flux3`, `device: default` |
| `3` | `VAELoader` | `flux2-vae.safetensors` |
| `4` | `CLIPTextEncode` | `text` = the prompt (enhanced: ← `47`), `clip` ← `2` |
| `32` | `ConditioningZeroOut` | ← `4` (the negative) |
| `11`, `12`, `13` | `LoadImage` | `image` = reference 1, 2, 3 |
| `17` | `ReferenceMultiLatent` | `resolution: resize`, `resolution.megapixels: 1`, positive ← `4`, negative ← `32`, `vae` ← `3`, `images.image0..2` ← `11`, `12`, `13` |
| `44` | `EmptyFlux2LatentImage` | `width`, `height`, `batch_size: 1` |
| `7` | `KSampler` | `seed`, `steps: 16`, `cfg: 1`, `euler`, `simple`, `denoise: 1`, model ← `1`, positive/negative ← `17` (0, 1), `latent_image` ← `44` |
| `8` | `VAEDecode` | ← `7`, `3` |
| `9` | `SaveImage` | `filename_prefix: image_edit`, images ← `8` |
| enhanced: `46` | `CLIPLoader` | `qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors`, `type: flux3`, `device: default` |
| enhanced: `48` | `PrimitiveStringMultiline` | `value` = the template's edit system prompt, verbatim (2,704 characters) |
| enhanced: `50` | `BatchImagesNode` | `images.image0..2` ← `11`, `12`, `13` |
| enhanced: `47` | `TextGenerate` | `prompt` = the prompt, `max_length: 3584`, `sampling_mode: on` with `temperature 1`, `top_k 1`, `top_p 0.95`, `min_p 0`, `repetition_penalty 1.05`, `presence_penalty 0`, `seed`; `thinking: false`, `use_default_template: true`, `mtp: off`, `clip` ← `46`, `image` ← `50`, `system_prompt` ← `48` (the template's values) |
| enhanced: `53` | `SaveText` | `text` ← `47`, `filename_prefix: image_edit_prompt`, `format: txt` |

**Fewer references.** An edit with one or two references leaves out the unused `LoadImage` nodes and every input linked to them (`17`'s and `50`'s `images.image1`/`image2`) before binding (`graph.ts`, `editGraph`), so the graph is exactly the template's shape for that many images; the shared binder (`buildGraph`) then checks every remaining binding.

## Inputs maps

| Param | Node.field |
| --- | --- |
| `prompt` | `4.text` (`CLIPTextEncode`); enhanced: `47.prompt` (`TextGenerate`) |
| `seed` | `7.seed` (`KSampler`); enhanced also `47.sampling_mode.seed` |
| `width`, `height` | `44.width/height` (`EmptyFlux2LatentImage`) |
| `reference_1`, `reference_2`, `reference_3` | `11.image`, `12.image`, `13.image` (`LoadImage`: the uploaded file's reference) |

## Recipes

`{ prompt, references: [{ sha256, width, height, character_id }], width, height, seed, origin, models, target, workflow }`, strict, one shape for both workflows (`workflow.id` tells them apart). `prompt` is the input trimmed; a reference is an image asset (`asset_id`) or a library character (`character_id`, resolved with the characters API's `getCharacter`; an uploaded character needs its likeness consent), stored by content with its stored size. `assetInputs` uploads each reference as `reference_<n>`. Without `width`/`height` the size is the first reference's aspect at about 1 MP (2^20 px), each side rounded down to a multiple of 16 within 256–2048 (a 768×1344 reference renders at 768×1344, as `ReferenceMultiLatent`'s own latent does), resolved once into the recipe. The seed is resolved once (random when not given); a retry draws a new one, a re-run keeps it (`rebase`, `null` when the workflow file changed). `origin` is the consumer's `{ feature, … }` (`null` when none). The first reference's character is the generation's `character_id`. Refused with `GenerateError` before anything is stored: an input that is not the schema, or `enhance` of the other definition (422 `invalid_input`), an unknown asset or character (404 `asset_not_found`, `character_not_found`), an asset that is not a stored image (422 `not_image`), an uploaded character without consent (422 `consent_required`), a size outside 0.5–1.6 MP (422).

`promptOf` is the user's prompt, never the upsampler's text. `shareRecipe` shows the recipe with `origin` cut to `{ feature }`; the recipe never holds the upsampled text, which is the private text output `caption`.

## Models

[`models.lock`](models.lock) is the character builder's lock, byte for byte (the same four files, URLs and SHA-256), so `npm run check:models` aggregates them without a conflict and a self-host pod installs nothing more. The direct workflow loads three of them, the enhanced one all four:

| File | Directory | Bytes | SHA-256 | Licence | Source |
| --- | --- | --- | --- | --- | --- |
| `flux3-image-klein-int8-convrot.safetensors` | `diffusion_models` | 5,827,874,779 | `847d8933…2e168fe2` | FLUX Kommunity License v1.0 | `black-forest-labs/flux-3-image-klein-comfy` @ `feef60b` |
| `qwen3vl_4b_int8_convrot.safetensors` | `text_encoders` | 4,858,559,240 | `32de113c…bf4ee01c` | Apache-2.0 | same |
| `qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors` | `text_encoders` | 6,724,090,780 | `e5d85a74…194a4458` | Apache-2.0 | same (enhanced only) |
| `flux2-vae.safetensors` | `vae` | 336,211,292 | `868fe7b3…0ce8f3` | Apache-2.0 | `Comfy-Org/Flux-2-Klein-4B` @ `533c4cb` (`split_files/vae/`) |

Gating, the SHA-256 provenance, int8 and Cloud's loader lists: `../../characterBuilder/workflows/README.md`, "Models".

**Licence obligations.** The transformer is under the [FLUX Kommunity License v1.0](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/blob/main/LICENSE.md): §2.e conditions use on reviewing outputs (or filtering them) before distribution and on disclosing that they are AI-generated where the law requires it. So both definitions publish on request (`publish: "on-request"`): a done edit has no share page until its owner publishes it (`POST /api/generations/:id/publish`, `PublishLink`), and the shared `GeneratedImage`/`GeneratedOutputs` label every output "AI-generated image" on `/g/:id` and `/r/:slug`. A consumer that shows an edit in its own UI labels it the same way and offers publishing only after the user has seen it. A reference is uploaded to Comfy as given: a consumer that renders a photo of a real person as that person takes it through a library character with likeness consent (`POST /api/characters`), not a raw upload.

## Validation

Every graph variant (1, 2 and 3 references, direct and enhanced, an explicit and a resolved size), as `editGraph` builds it, passed ComfyUI 0.42.0's `/prompt` validation at the pin with only the expected errors (the pin has no weights and no input images) and rendered once on Comfy Cloud through the repository's SDK provider. Cases, commands, outputs and verdicts: [`docs/feature-evidence/image-edit/`](../../../../docs/feature-evidence/image-edit/README.md).

## Measurements (Comfy Cloud, 2026-10-27)

One run per graph variant through `comfy-run.ts` (the repository's SDK provider), under the render lease; cost is the account's balance delta per job (approximate), latency the runner's submit → done with Cloud's queue.

| Case | Workflow | References | Size | Job | Submit → done | Balance Δ |
| --- | --- | --- | --- | --- | --- | --- |
| `d1-direct-1ref` | direct | 1 | 768×1344 (resolved) | `4ccb96fd-cbeb-477f-b9dd-966e038c9031` | 25.3 s (17.9 s queued) | 0.67 ¢ |
| `d2-direct-2ref` | direct | 2 | 1024×1024 | `ec38ec6b-584b-4f1a-934c-250cefecbddb` | 12.9 s | 1.10 ¢ |
| `d3-direct-3ref` | direct | 3 | 1344×768 | `93130e43-c1a8-418a-b6a7-da439feed612` | 12.8 s | 1.09 ¢ |
| `e1-enhanced-1ref` | enhanced | 1 | 1024×1024 | `d27bf2d1-5211-4443-97a5-9d0bf5501ce3` | 10.4 s | 0.82 ¢ |
| `e3-enhanced-3ref` | enhanced | 3 | 1344×768 | `a9f8a79b-8ed0-4133-b5b5-dbc56146c3c8` | 15.2 s | 1.44 ¢ |

All five kept every person's face, hair and outfit. `d1` is pixel-identical to the bake-off's render of the same prompt, seed and reference through `ReferenceMultiLatent`'s own `empty_latent`, which is why the graph can always take its size from `EmptyFlux2LatentImage`. The bake-off's single-reference medians over 12 edits: direct 10.4 s / 0.59 ¢, enhanced 10.5 s / 0.81 ¢.

Self-host: not verified on self-host (no pod in this program); the files and classes are the character builder's, which rendered on a Runpod A40 (`../../characterBuilder/workflows/README.md`, "Self-host").
