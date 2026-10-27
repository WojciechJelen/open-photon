# Product Studio — ComfyUI evidence (Comfy Cloud, 2026-10-27)

Feature id `product-studio`. Every render below went through `feature-coord/comfy-run.ts` (the
coordinator lease, this worktree's `createSdkProvider`); each `runs/<label>.run.json` has the job id,
timings and balance delta. Full-resolution outputs stay in ignored
`work/feature-evidence/product-studio/runs/`; `sheets/` holds downscaled JPEG contact sheets
(≤ 101 KB each). Every output was looked at; label crops were compared side by side.

**Verdict: PASS for opaque products (labels, logos, shape and colour preserved pixel-for-pixel);
EXPERIMENTAL for transparent/reflective products** — see "Limitations".

## Quality gate

Preserve product shape, colour, packaging, logos and readable label text; test a product with
readable text/logo, a reflective or transparent product, more products, and a difficult case.

## Inputs (`sheets/inputs.jpg`)

| Case | Source | Licence | Why |
| --- | --- | --- | --- |
| `calem` | [Calem White & Dry Porto Wine Bottles](https://commons.wikimedia.org/wiki/File:Calem_White_%26_Dry_Porto_Wine_Bottles_(55242019592).jpg), Michael Gaylard (Flickr), cropped to the middle bottle, 684×1344 | CC BY 4.0 | real photo, green glass, dense label text; **difficult**: shot in a scene (dark wall, wooden shelf), neck cut by the frame and covered by a black display holder |
| `chanel` | [CHANEL No5 parfum](https://commons.wikimedia.org/wiki/File:CHANEL_No5_parfum.jpg), user Arz, 400×727 | Public domain (photo) | **transparent** glass, glass stopper, small low-res label |
| `thermos` | rendered here with FLUX 3 Klein (`klein-t2i.api.json` = `character-generation.v1`, seed 1234, `runs/input-thermos.run.json`) | own render | **mirror chrome**, printed logo "NORDHAVN 750 ml" |
| `tube` | rendered here likewise (`runs/input-tube.run.json`) | own render | matte tube, logo + "VERDA / Hydrating Face Cream / 50 ml" |

Brand names appear only as test subjects of the photos' own content (trademarks are their owners').

## Approaches tried

1. **Generative reference edit** (Foundation's `feature-coord/graphs/flux3-klein-edit.api.json`,
   FLUX 3 Klein distilled, and `qwen-edit-2511.api.json`, Qwen-Image-Edit-2511 int8, 40 steps):
   the product photo as the only reference, the lifestyle prompt + "keep the product exactly…".
2. **Matte + generate around + composite** (owned by this feature, `graphs/composite-*.api.json`,
   runtime `src/features/productStudio/workflows/product-shot.v1.json`): core
   `LoadBackgroundRemovalModel`/`RemoveBackground` (BiRefNet) mattes the photo fitted into a box on a
   1024² canvas; FLUX 3 Klein distilled regenerates only the scene (`SetLatentNoiseMask` = inverse of
   the product mask shrunk 6 px, `ReferenceMultiLatent` of the canvas, 16 steps, cfg 1), then
   `ImageCompositeMasked` pastes the photo's own pixels back (mask shrunk 2 px).

Iterations of approach 2 (`sheets/` from the `comp-*`/`v2-*` runs):

- `comp-noref` vs `comp-ref` (tube): without the reference the model paints a **second, larger
  tube** around the pasted one (double outline). With `ReferenceMultiLatent` it paints the scene
  tightly around the product → keep the reference.
- `comp-ref` (v1 canvas = photo padded with its own background): on the Calem crop the model
  again drew a wider ghost bottle (the canvas still showed the original dark wall around it).
- **v2** (the runtime design): the matted product is placed on a neutral grey canvas
  (`EmptyImage` + `ImageCompositeMasked`), the mask is placed with `MaskComposite`. Ghosts gone in
  all v2 and final runs except one mild case (below).

## Results — final runtime workflow (`final-*`, seed 42, prompts exactly as `workflows/prompts.ts`)

`sheets/final-<product>.jpg` = input | packshot | lifestyle | advertising; `sheets/final-formats.jpg`
= tube lifestyle portrait 896×1152 | thermos advertising landscape 1216×832 | Chanel lifestyle with
a user scene description ("a white marble vanity in a hotel bathroom…").

| Product | Packshot | Lifestyle | Advertising | Notes |
| --- | --- | --- | --- | --- |
| tube | pass | pass | pass | clean edges, plausible contact shadows; portrait pass |
| thermos (chrome) | pass | pass | pass (square) / **flaw** (landscape) | chrome keeps the white-studio reflections of the photo: reads slightly pasted on the violet backdrop; landscape run drew a dark ghost rim around the lid + glow |
| calem (difficult) | pass* | pass* | pass* | label perfect; *the black display holder over the neck is kept as "product" (BiRefNet cannot know it is not); bottle floats ~1 px above podium in advertising |
| chanel (transparent) | pass | pass | pass | label perfect; the stopper and the glass edges show the **original white background** through them; no refraction of the new scene; amber caustic shadow on the oak table was generated and looks right |

**Label text, crop level** (`sheets/label-<product>.jpg` = input resized | composite | Klein edit |
Qwen edit): mean absolute difference between the input label (resized with PIL Lanczos to the
canvas scale) and the composite at the same pixels: tube 0.93, thermos 0.49, Calem 3.13, Chanel 6.11
(0–255 scale; ComfyUI's vs PIL's resampling, no content change — the pixels are the photo's).
Klein edit re-renders the product: in these 4 runs the label text stayed legible and very close
(small text included), but it is not guaranteed (it is regenerated). Qwen-Image-Edit-2511 changed the
Calem bottle (lighter green glass, different capsule) and softened small text, at ~10× the cost.

## Decision

Approach 2 is the runtime workflow: only it guarantees logos and label text by construction, it
costs about the same as a Klein edit, and its failure modes are visible (edges/reflections), not
silent text changes. Klein edit (`imageEdit`) remains an option for a later "re-imagine" mode.

## Latency and cost (Comfy Cloud, `balance_delta_cents`)

| Graph | Submit → done | Cost per render |
| --- | --- | --- |
| product-shot.v1 (composite) | 7.9–13.1 s when the GPU was free (29–47 s with Cloud queueing) | 0.51–1.19 ¢ |
| Klein edit (Foundation graph) | 7.8–8.7 s | 0.52 ¢ |
| Qwen-Image-Edit-2511 (40 steps) | 41.8–50.5 s | 4.93–6.42 ¢ |
| input renders (Klein t2i 768×1024) | 5.5 s | 0.26 ¢ |

Total Phase 1 spend: 39 runs, **42.1 ¢** (budget $3).

## Models (runtime `models.lock`)

| File | Dir | Source | SHA-256 | Licence |
| --- | --- | --- | --- | --- |
| `flux3-image-klein-int8-convrot.safetensors` | diffusion_models | black-forest-labs/flux-3-image-klein-comfy @ feef60b | 847d8933…2e168fe2 | FLUX-Kommunity-1.0 |
| `qwen3vl_4b_int8_convrot.safetensors` | text_encoders | same | 32de113c…bf4ee01c | Apache-2.0 |
| `flux2-vae.safetensors` | vae | Comfy-Org/Flux-2-Klein-4B @ 533c4cb | 868fe7b3…0ce8f3 | Apache-2.0 |
| `birefnet.safetensors` (444,473,596 B) | background_removal | Comfy-Org/BiRefNet @ 25511f87 | 9ab37426…6a154 | MIT (upstream ZhengPeng7/BiRefNet MIT); approved by the coordinator, schema 19ed043 |

## Limitations (shown in the UI copy and the feature README)

- Transparent products keep the background they were photographed on (seen through glass); no
  refraction of the new scene. Chrome/mirror products keep the photo's reflections. Best input: the
  product on a plain light background.
- Anything the matte includes is kept: props/hands touching the product (Calem's holder) stay.
- Occasional silhouette artefact (1 of 15 final renders: a dark rim around the thermos lid in the
  landscape ad); a retry draws a new seed.
- Shadows/reflections under the product are generated by the model and usually plausible, but the
  product's own shading is not relit to the scene.

## Reproduce

```sh
C=/Users/wojciechjelen/workspace/comfy-challenge/open-photon-wt/feature-coord
W=/Users/wojciechjelen/workspace/comfy-challenge/open-photon-wt/feat-product-studio
node --experimental-strip-types $C/comfy-run.ts --repo $W --owner product-studio --label final-tube-lifestyle \
  --graph $W/src/features/productStudio/workflows/product-shot.v1.json --out $W/work/feature-evidence/product-studio/runs/final-tube-lifestyle \
  --image 10=<tube.png> --set '4.text=<shotPrompt("lifestyle", "a white cosmetic squeeze tube of face cream")>' --set 7.seed=42 \
  --set 20.target_width=608 --set 20.target_height=736 --set 24.x=208 --set 21.x=208 --set 24.y=160 --set 21.y=160 \
  --set 22.width=1024 --set 23.width=1024 --set 22.height=1024 --set 23.height=1024
```

Every case's exact `--set` values are in its `runs/<label>.run.json` (`sets`).
