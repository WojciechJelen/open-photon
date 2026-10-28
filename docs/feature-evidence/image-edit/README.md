# Image edit (`src/features/imageEdit/`): evidence

Foundation, 2026-10-27. The shared reference-image edit other features submit through the generation service: FLUX 3 Image Klein distilled, `image-edit.v1` (the prompt as given) and `image-edit-enhanced.v1` (FLUX 3's prompt upsampler first). Workflow, recipe and lock: `src/features/imageEdit/workflows/README.md`.

**Verdict: pass on Comfy Cloud** for 1, 2 and 3 references, direct and enhanced, at a resolved and at explicit sizes; every output was looked at. **Not verified on self-host** (no pod in this program; the four model files and every node class are the character builder's, which rendered on a Runpod A40).

## Contents

| Path | What |
| --- | --- |
| `BAKEOFF.md`, `bakeoff/` | The identity bake-off that chose Klein (12 edits × Klein, Klein + upsampler, Qwen-Image-Edit-2511, 2511 + Lightning, Qwen-Image 2.1): contact sheets `sheet-a/b/c.jpg`, `faces-closeup.jpg`, and every case's `run.json` (`bakeoff/runs/`). Copied from the coordinator's `graphs/` as reviewed. |
| `graphs/flux3-klein-edit*.api.json` | The bake-off's trimmed API graphs (template `image_flux3_klein_distilled_image_edit.json` @ `3c2199b`): 1 reference, 3 references, with the upsampler. |
| `refs/*.run.json` | How the three references were rendered (`character-generation.v1`, 768×1344, seeds 2001–2003, captions inside). |
| `graphs/<case>.api.json` | The runtime graphs as `editGraph` (`workflows/graph.ts`) builds them from `image-edit.v1.json` / `image-edit-enhanced.v1.json` for each validation case, with placeholder file names in `LoadImage` (the runner binds the uploads). |
| `runs/<case>/run.json` | Each validation run: Cloud job id, status, timings, balance delta, outputs; the enhanced runs' upsampled prompt (`53-0-image_edit_prompt_00001.txt`). |
| `sheets/*.jpg` | Downscaled contact sheets: references, then the output. |

## Reproduce

The references are `$C/graphs/refs/ref-{a,b,c}-*.png` (`$C` = the coordinator's `feature-coord/`). The case graphs come from the runtime files (`EDIT_PARAMS`/`editGraph`; prompts, seeds and sizes as in each graph):

```ts
// node --experimental-strip-types <script>.ts, from the repository
import { editGraph } from "./src/features/imageEdit/workflows/graph.ts";
import { imageEditEnhancedWorkflow, imageEditWorkflow } from "./src/features/imageEdit/workflows/registry.ts";

const references = ["reference_1.png", "reference_2.png", "reference_3.png"].slice(0, count);
const graph = editGraph(enhanced ? imageEditEnhancedWorkflow : imageEditWorkflow, { height, prompt, references, seed, width });
```

At the pin (ComfyUI 0.42.0, CPU, no weights): `curl -X POST http://127.0.0.1:8288/prompt -d '{"prompt": <graph>}'`. On Cloud, one at a time under the render lease:

```sh
node --experimental-strip-types $C/comfy-run.ts --repo <worktree> --owner foundation --label ie-<case> \
  --graph docs/feature-evidence/image-edit/graphs/<case>.api.json --out $C/runs/foundation/imageedit/<case> \
  --image 11=$C/graphs/refs/ref-a-woman-glasses-hat-bag.png [--image 12=… --image 13=…]
```

## Pin validation

Each of the five case graphs answered `prompt_outputs_failed_validation` with only the expected node errors: `value_not_in_list` for `UNETLoader.unet_name`, `CLIPLoader.clip_name` (and `46`'s upsampler file), `VAELoader.vae_name` (the pin has no weights), and `custom_validation_failed` "Invalid image file" for each bound `LoadImage` (no input images there); a graph with fewer references names only its own `LoadImage` nodes. No other error: every class, link and literal validates at ComfyUI 0.42.0.

## Cloud cases

References: a = woman, glasses, hat, bag; b = older man, open hands; c = teenager, varsity jacket, backpack (all 768×1344).

| Case | Workflow | Refs | Size | Seed | Job | Submit → done | Cost | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `d1-direct-1ref` | direct | a | 768×1344 (resolved from a) | 7 | `4ccb96fd-cbeb-477f-b9dd-966e038c9031` | 25.3 s (17.9 s of it queued) | 0.67 ¢ | **Pass.** Cobblestone street; face, glasses, hat, sweater, trousers, sneakers, bag kept. **Pixel-identical** (mean and max absolute difference 0 on every channel) to the bake-off's `p1-klein` render of the same prompt, seed and reference through `ReferenceMultiLatent`'s `empty_latent`: the explicit `EmptyFlux2LatentImage` at the reference's size is the same latent. |
| `d2-direct-2ref` | direct | a, b | 1024×1024 | 11 | `ec38ec6b-584b-4f1a-934c-250cefecbddb` | 12.9 s | 1.10 ¢ | **Pass.** Both people side by side in a gallery, both faces and outfits kept, consistent scale. The man keeps his reference's raised open palms (Klein copies a gesture the prompt does not change). |
| `d3-direct-3ref` | direct | a, b, c | 1344×768 | 11 | `93130e43-c1a8-418a-b6a7-da439feed612` | 12.8 s | 1.09 ¢ | **Pass.** All three seated at a garden-café table, landscape; faces (a's freckles and glasses, b's beard, c's undercut), hat, tie, varsity "P" and backpack kept; b's hands now clasped on the table. |
| `e1-enhanced-1ref` | enhanced | b | 1024×1024 | 11 | `d27bf2d1-5211-4443-97a5-9d0bf5501ce3` | 10.4 s | 0.82 ¢ | **Pass.** A real mid-stride walk on a wet dusk sidewalk with an umbrella (the direct prompt tends to keep the frontal pose); face, beard, suit, tie, watch and shoes kept. Caption: 1,253 bytes. |
| `e3-enhanced-3ref` | enhanced | a, b, c | 1344×768 | 11 | `a9f8a79b-8ed0-4133-b5b5-dbc56146c3c8` | 15.2 s | 1.44 ¢ | **Pass.** All three full body and smiling, identities and outfits kept; the sign reads "OPEN PHOTON" correctly (partly behind b's head). They stand inside the shop's entrance rather than outside. Caption: 1,422 bytes. |

Total 5.12 ¢ (sum of `balance_delta_cents`; billing granularity is undocumented, so single-job deltas are approximate). Latency is the runner's submit → done, Cloud queue included.

Measured spread: direct ~0.7 ¢ for one reference and ~1.1 ¢ for two or three; enhanced ~0.8–1.4 ¢; 10–15 s once the job runs. The bake-off's single-reference medians (12 cases each): direct 10.4 s / 0.59 ¢, enhanced 10.5 s / 0.81 ¢ (≈20 s cold).

## Limitations

- Klein copies the reference's pose and gestures unless the prompt changes them (d2's palms); a pose change works best enhanced (e1). A strict 90° profile is not guaranteed (bake-off).
- Without the upsampler, text in the image is garbled (bake-off e1); enhanced, a short sign renders (e3).
- The enhanced upsampler may reinterpret placement ("in front of" became the entrance, e3) and describe people in its own words; the user's prompt, not that caption, is what `promptOf` keeps.
- Several references cost more (~1.1 ¢) than one.
- Cloud's `object_info` does not list the FLUX 3 files, but jobs that load them succeed (as for the character builder). Not verified on self-host.
- FLUX Kommunity License: outputs are reviewed before they are published (`publish: "on-request"`) and labelled AI-generated.
