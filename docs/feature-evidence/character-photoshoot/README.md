# Character Photoshoot: ComfyUI evidence (Comfy Cloud, 2026-10-27)

**Verdict: pass, with limitations** (below). FLUX 3 Image Klein distilled edit **with the FLUX 3
prompt upsampler** (`image-edit-enhanced`, the shared `imageEdit` workflow) keeps a character
recognizable (face, hair, glasses, bow tie, earring, watch, beanie, outfit) while the setting,
pose and light visibly change, across an illustrated gentleman with accessories, an anime
character, a busy cyberpunk outfit with a gold prosthetic arm, and a candid phone-photo-like
half-body reference. Every image below was looked at in full resolution; contact sheets are
downscaled.

## How to reproduce

All renders went through the coordinator's runner (render lease + this worktree's
`createSdkProvider`), one at a time:

```sh
# one case: <model> <character> <reference> <setting> <shot 0-3> [seed, default 1001 + shot]
bash docs/feature-evidence/character-photoshoot/run-case.sh klein3pe yuki \
  src/features/characters/samples/characters/yuki.png studio 1
# the matrix (every character × every setting, each at a different shot, + a full Maya session)
bash docs/feature-evidence/character-photoshoot/run-cases.sh
# a sheet: reference, then each case in the order given
bash docs/feature-evidence/character-photoshoot/contact-sheet.sh out.jpg <reference> <case dir>...
```

The prompt is the app's own: `compileShotPrompt(setting, shot)` of
`src/features/photoshoot/settings.ts`, read by `run-case.sh` at run time. Output folders are
`work/feature-evidence/character-photoshoot/<model>-<prompt version>/<character>-<setting>-<shot>/`
(ignored); each case's `run.json` (job id, timings, balance delta, the exact prompt in `sets`) is
copied to `runs/`, and an upsampled caption next to it as `*.caption.txt`.

## Graphs (`graphs/`)

| Model id | Graph | Prompt / reference / seed | Notes |
| --- | --- | --- | --- |
| `klein3` | `klein3-edit.api.json` (hand-flattened from `image_flux3_klein_distilled_image_edit.json` @ `3c2199b`; node for node the same as Foundation's `flux3-klein-edit.api.json`) | `4.text` / `11` / `7.seed` | 16 steps, cfg 1, euler/simple, `ReferenceMultiLatent` resize 1 MP → output at the reference's aspect |
| `klein3pe` | `flux3-klein-edit-pe.api.json` (Foundation) | `47.prompt` (upsampler request) / `11` / `7.seed` | FLUX 3 prompt upsampler (`TextGenerate`, sees the reference) writes the caption → same edit path; caption saved by `SaveText` `53` |
| `qwen2511` | `qwen-edit-2511.api.json` (Foundation) | `170:151.prompt` / `41` / `170:169.seed` | Qwen-Image-Edit-2511 int8, 40 steps, cfg 4, no LoRA |

Models (FLUX path; identical to `src/features/imageEdit/workflows/models.lock` and
`characterBuilder`'s lock): `flux3-image-klein-int8-convrot.safetensors` (FLUX Kommunity 1.0,
`847d8933…2e168fe2`), `qwen3vl_4b_int8_convrot.safetensors` (Apache-2.0, `32de113c…bf4ee01c`),
`qwen3.5_9b_flux3_prompt_upsampler_w4a8.safetensors` (Apache-2.0, `e5d85a74…194a4458`), all
`black-forest-labs/flux-3-image-klein-comfy` @ `feef60b`; `flux2-vae.safetensors` (Apache-2.0,
`868fe7b3…0ce8f3`, `Comfy-Org/Flux-2-Klein-4B` @ `533c4cb`). All nodes are core and exist at the pin
and on Cloud (Foundation's `graphs/README.md`); no partner/API or custom nodes.

## Inputs

| Character | Reference | Why |
| --- | --- | --- |
| `arthur` | `src/features/characters/samples/characters/arthur.png` (repo sample, FLUX 3 Klein) | accessories: round glasses, bow tie; illustrated style |
| `yuki` | `…/yuki.png` (repo sample) | stylized: anime illustration |
| `cyborg` | `fixtures/wan/reference.png` (Comfy-Org/workflow_templates `input/pink_hair_mech_arms_ref.png`, MIT repo) | difficult: busy outfit, gold prosthetic arm, straps, studs |
| `photo` | rendered for this test with `character-generation.v1` (`runs/inputs/photo-ref.run.json`, seed 4242, 896×1152; `sheets/input-photo-like-ref.jpg`) | uploaded-photo-like: candid phone snapshot, cluttered kitchen, knees up only, beanie, hoop earring, watch |
| `maya` | `…/maya.png` (repo sample) | a complete four-shot Street session |

## Prompt versions

- **p1** (identity first: "The same person as in the reference … A full-body shot of this person
  in …, <pose>. Lighting: …"), direct Klein: identity perfect, but the reference's front-facing
  standing pose often survived (`sheets/p1-arthur-direct.jpg`: the zebra-crossing walk and the
  staircase look-back did not happen).
- **p2** (the new picture first, "A … photograph …", identity after): direct Klein still stood still
  on the crossing (`sheets/street-1-direct-enhanced-qwen.jpg`, panels 1–2); **with the upsampler**
  the walk, the hand on the hip, the raised fists all happened (`sheets/p2-arthur-enhanced.jpg`).
  But for the anime character the word "photograph" made the upsampler write "translating her into
  a real person" (`runs/klein3pe-p2/yuki-studio-1.caption.txt`): a photoreal woman
  (`sheets/p2-yuki-style-drift.jpg`, panel 1).
- **p3** (shipped): no "photograph"; the medium is stated ("a drawing or anime illustration stays a
  drawing in the same style, a 3D render stays a 3D render, a photo stays a photo"). All four Yuki
  shots stay anime (`sheets/p3-yuki.jpg`).

Model comparison on the hardest pose (Arthur, Street shot 1, seed 1002,
`sheets/street-1-direct-enhanced-qwen.jpg`: reference, Klein p1, Klein p2, Klein+upsampler p2,
Qwen 2511 p2): only the upsampler path and Qwen walked; Qwen drifted (thinner glasses, an added
pocket square, feet cropped) at 55 s and 6.5 ¢ against 10 s and 0.8 ¢.

## Cases (shipped path: `klein3pe`, prompt p3)

Panels in each sheet: reference, then the cases in the order listed.

| Sheet | Cases | Observations |
| --- | --- | --- |
| `sheets/p3-yuki.jpg` | studio 1 (arms crossed, Rembrandt, charcoal), street 2 (café, coffee cup, dappled sun), editorial 3 (colour-block wall), outdoors 0 (meadow, backlight) | anime style, silver bob, violet eyes, red bomber, skirt, leggings, sneakers kept in all four; poses and light follow; crossed arms and cup hand clean. Gallery wall pose is close to the reference (it asks for arms at the sides). |
| `sheets/p3-photo.jpg` | studio 3 (mid-stride, rim light), street 0 (leaning on brick wall, golden hour), editorial 1 (close-up, hand to chin, flash), outdoors 2 (forest log, hands clasped) | same face, beard, beanie, hoop earring, watch, flannel shirt; the legs and shoes the reference never showed are invented plausibly (dark trousers, boots); realistic photo stays a photo. Studio's teal/orange rim light came out as a teal wash only. |
| `sheets/p3-cyborg.jpg` | studio 2 (stool, high-key), street 3 (neon, wet pavement), editorial 0 (velvet armchair), outdoors 1 (beach, barefoot, profile) | pink hair, studded cropped jacket, belts, thigh straps, gold arm kept; poses strongly changed. **Drift:** the asymmetric prosthetic is not stable: in studio and armchair both forearms come out gold (the reference has one gold arm and one gold glove). Background signage text is legible ("NIGHT MARKET") in p3, garbled in p2. |
| `sheets/p2-arthur-enhanced.jpg` (p2 wording) | studio 0, street 1, editorial 2, outdoors 3 | glasses, bow tie, beard, suit, brogues identical; hand on hip, walk, banister, raised fists all follow; light changes clearly (soft studio, overcast street, chandelier, midday sun); fists and fingers correct at full size. The look-back over the shoulder did not happen. |

p3 cases still rendering when this was committed (Arthur editorial/outdoors at p3 and the Maya
four-shot Street session) are in `work/` and are not claimed here.

## Latency and cost (Cloud, `run.json`)

| Path | Renders | submit → done | Balance Δ per render |
| --- | --- | --- | --- |
| Klein direct (`klein3`) | 6 | 7.8–23.4 s (median ≈ 12 s) | 0.53–1.23 ¢ |
| Klein + upsampler (`klein3pe`) | 25 | 10.2–25.0 s (median ≈ 11 s) | 0.78–1.90 ¢ (median ≈ 0.83 ¢) |
| Qwen 2511 int8, 40 steps | 1 | 55.1 s | 6.52 ¢ |

A four-shot photoshoot therefore costs about 3.3–4 ¢ on Cloud. Total spend of this evidence:
33 renders, 41.2 ¢ (sum of `balance_delta_cents`; billing deltas per job are approximate), well
under the $3 budget. Queue wait for the shared lease is not included (it was 3–10 min per job with
six agents).

## App smoke on Cloud (through the app, lease held by hand)

`npx vite dev` on :3110 with the Cloud key (`IN_FLIGHT_MAX=1`), commit `592a07f`; a browser picked
Yuki and Outdoors and clicked "Shoot 4 photos" (`POST /api/photoshoots` 201, photoshoot
`8961997c-e485-4dec-becb-4356d62a88d7`). The four `image-edit-enhanced` generations
(`8b8f233f…`, `03aa7ae2…`, `682377a0…`, `7688abd0…`) ran one after another and were all `done`
103.8 s after the click (submit → finished 16.0 s, 13.6 s, 45.3 s, 14.9 s), each with a 768×1344
`image` and a private `caption`; balance 7016.29 → 7012.48 ¢ (3.81 ¢ for the photoshoot).
"Save to library" on shot 2 created character `3e84b990…` (`origin: generated`); `/g/<id>` 200;
publishing gave `/r/b14a2740590e9ccf` 200. Screenshot: `sheets/app-smoke-yuki-outdoors.jpg`
(meadow walk, barefoot at the surf in profile, seated on a log, arms raised on a lookout; anime
style, hair, eyes and outfit kept).

## Limitations

- Framing words are followed loosely: "waist-up" and "close-up" mostly happen, "from below" /
  "low angle" rarely.
- Asymmetric details can mirror (the cyborg's gold arm), and garments the reference does not show
  are invented (the photo reference's trousers and boots).
- A requested look-back over the shoulder is often ignored.
- Every result is AI-generated and private until published (`publish: "on-request"`, FLUX Kommunity
  licence: review before distribution).
- Not verified on self-host (no pods in this program).
