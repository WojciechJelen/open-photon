# Identity bake-off for the shared `imageEdit` (Foundation, 2026-10-27)

**Recommendation: FLUX 3 Image Klein distilled edit (`flux3-klein-edit.api.json`), with the FLUX 3
prompt upsampler as an input option (`flux3-klein-edit-pe.api.json`, `enhance_prompt`).** It kept
identity best on all three characters, is 5–8× cheaper and ~4× faster than Qwen-Image-Edit-2511, and
needs no new model file (every file is already in `characterBuilder/workflows/models.lock`).

## Setup

- References: `refs/ref-a-woman-glasses-hat-bag.png`, `refs/ref-b-older-man-open-hands.png`,
  `refs/ref-c-teen-varsity-backpack.png` (768×1344, FLUX 3 Klein renders).
- Four edits per character, same text for every model (graph param = prompt), seed 11:
  - `e1-setting` café at night, tungsten + pink neon, full body standing;
  - `e2-pose` sitting on a park bench, forearms on knees, hands clasped;
  - `e3-closeup` tight head-and-shoulders portrait, window light;
  - `e4-profile` full side profile (camera 90° to the left), studio backdrop.
- All renders on Comfy Cloud through `comfy-run.ts` (our SDK provider), one at a time under the
  render lease. Every output was looked at; contact sheets (downscaled) in `bakeoff/`:
  `sheet-a.jpg`, `sheet-b.jpg`, `sheet-c.jpg` (rows = edits, columns = ref + candidates) and
  `faces-closeup.jpg` (each reference's face crop next to each model's close-up). `run.json` of every
  case in `bakeoff/runs/`; full-resolution PNGs in `$C/runs/foundation/bakeoff/<case>/`.
- Latency = runner's submit→done (Cloud queue included); cost = Cloud balance delta per job
  (approximate, billing granularity undocumented). Median over the cases.

## Results

| Model (graph) | Cases | Identity (face) | Outfit / accessories | Hands | Prompt adherence | Artifacts | Latency (median) | Cost (median) | Licence | Lock fit | Pin / Cloud |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FLUX 3 Klein distilled edit (`flux3-klein-edit`) | 12/12 ok | **Best**: same face in all 12 incl. close-ups (a's freckles, b's beard/wrinkles, c's eyes/undercut) | Kept everywhere (hat, glasses, bag, watch, varsity "P", backpack) | Good: clasped hands in e2 for all three, 5 fingers | Setting, sitting pose, close-up all followed; profile true for a and c; b's profile keeps the reference's raised palms (carried-over gesture) | Garbled neon-sign text in e1; otherwise clean | 10.4 s | 0.59 ¢ | FLUX Kommunity 1.0 (transformer) + Apache-2.0 | **Already locked** (characterBuilder lock) | all classes at pin and Cloud; files served by Cloud (not in its loader lists, as documented) |
| Klein + prompt upsampler (`flux3-klein-edit-pe`) | 12/12 ok | Same as Klein (best) | Same; a's bag moved to the front in e4 | Good | Like Klein; readable sign text ("CAFE"); profiles weaker (a and b turn toward camera / 3/4); PhotoshootWorker measured that PE is what makes dynamic poses (walking) work where the direct prompt stays frontal | Clean | 10.5 s (≈20 s cold) | 0.81 ¢ | same | **Already locked** (upsampler file in the same lock) | same |
| Qwen-Image-Edit-2511 int8, 40 steps, CFG 4 (`qwen-edit-2511`) | 12/12 ok | **Drifts**: a's face changes (freckles gone, narrower face), c gets **glasses he never had** in e3; b closest | Mostly kept; c's backpack lost in e4 | Good | Followed setting/pose/profile well; e3 not a tight close-up for b and c | Garbled sign text; softer, slightly composited look | 42.7 s | 4.96 ¢ | Apache-2.0 | Fits (Comfy-Org/Qwen-Image-Edit_ComfyUI @ f68ace8 + Comfy-Org/Qwen-Image_ComfyUI @ 1f12b17) | all classes at pin and Cloud; files in Cloud's loader lists |
| Qwen-Image-Edit-2511 + Lightning 4-step LoRA (`qwen-edit-2511-lightning`) | partial (see note) | Drifts like base 2511 (a's face) | Kept | ok | Follows the edit | Slight pasted-subject look | 15.3 s | 1.41 ¢ | Apache-2.0 (lightx2v) | **Now allowed** (commit 6192622, root file in `loras`) | all classes at pin and Cloud |
| Qwen-Image 2.1 edit / turbo (`qwen-image-2.1-*`) | 0 — **fail on Cloud** | — | — | — | — | Every job fails in `KSampler`/`SamplerCustomAdvanced`: `module 'os' has no attribute 'memfd_create'` (Cloud's `comfy/model_patcher.writable_model` → `anonymous_file`), with and without `QwenImage21Cache`; one retry with `weight_dtype fp8_e4m3fn` queued | — | 0 ¢ (fails before sampling) | **Qwen RESEARCH licence: non-commercial only** (`licences/Qwen-Image-2.1-LICENSE.txt`) | Licence not in the enum → not lockable | classes exist at pin and Cloud; Cloud cannot run it |

First-pass single case (ref-a, cobblestone street): Klein 8.0 s / 0.55 ¢, Klein+PE 20.1 s / 1.74 ¢,
Qwen 2511 51.4 s / 6.05 ¢, Lightning 8.6 s / 0.40 ¢ — all four kept the woman, hat, glasses, bag.

Note on Lightning: the bake-off batch was still rendering its remaining cases when this report was
written (lease queue); the row covers the cases finished so far and the first-pass case. Results
land in `$C/runs/foundation/bakeoff/bo-q2511-light-*`. Multi-reference (3 people, `*-3ref`) runs
are queued after it (`bo-klein-3ref-multi`, `bo-q2511-3ref-multi`).

Data from other workers (same graphs, their own inputs): StoryboardWorker — Klein with an explicit
1344×768 `EmptyFlux2LatentImage` held identity/outfit/style on 7/7 landscape cards (7.9–29.7 s,
0.52–0.91 ¢), poses tend to stay frontal; an outfit change was ignored when the prompt also said
"keep the outfit". PhotoshootWorker — direct-prompt Klein kept a static front pose for "walking";
Klein+PE produced a real walk with identity intact (10.3 s, 0.84 ¢); Qwen 2511 walked but drifted.

## Why Klein, and the implications

- **Identity** is the gate for Photoshoot/Storyboard/Angles; Klein is the only candidate with no
  identity drift in 12/12, Qwen 2511 hallucinated an accessory and changed a face.
- **Cost/latency**: ~0.6–0.8 ¢ and ~10 s vs ~5 ¢ and ~43 s per image; Lightning closes the cost gap
  but keeps 2511's identity drift.
- **Licence**: the FLUX 3 transformer is FLUX Kommunity 1.0 (as in characterBuilder): the shared
  definition must use `publish: "on-request"` and the AI-generated label (already the shared
  `GeneratedImage`/`GeneratedOutputs`), and keep the README's licence notes. Qwen 2511 + Lightning
  would be fully Apache-2.0 — the fallback if a feature needs Apache-only weights; Angles may still
  own a Qwen 2511 + multiple-angles LoRA workflow for camera moves.
- **Lock**: no new file for Klein (reuse the four characterBuilder pins byte for byte; aggregate
  check stays conflict-free). Qwen 2511 would add ~30 GB of weights to the self-host image.
- **Weaknesses to design around**: Klein copies the reference pose/gesture unless the prompt is
  explicit (use `enhance_prompt` for pose changes), garbles in-image text without the upsampler, and
  a strict 90° profile is not guaranteed.

Spend for this whole phase (refs, first pass, bake-off): ≈ $0.95 of the $3 budget at writing.
