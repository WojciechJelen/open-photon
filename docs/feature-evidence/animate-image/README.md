# Animate Image: ComfyUI evidence (Comfy Cloud, 2026-10-27)

Gate for the Animate Image feature (`animate-image`): one still image plus a text description of
an action into a short video, image-to-video, without any driving-motion clip.

**Verdict: pass**, with the limitations listed below. Wan 2.2 14B image-to-video (fp8) with the
lightx2v 4-step LoRAs, exactly the official template's "4steps LoRA" path, kept the subject's
identity and appearance in all seven cases, performed the requested action visibly in six of
seven (the seventh, a full turn-around, only turned about 135°), stayed temporally stable, and
wrote H.264 High / yuv420p MP4s with `moov` first that play in Chromium. It costs about 3.4 ¢
and 30 s (submit → done) per 5 s clip on Comfy Cloud. Every model file is a Comfy-Org repackaging
under Apache-2.0, so it fits the `models.lock` schema as is.

## Workflow

- Template: `video_wan2_2_14B_i2v.json` (Comfy-Org/workflow_templates @ `3c2199b`), subgraph
  "Image to Video (Wan2.2)", flattened by hand to API format with the "Enable 4steps LoRA?" switch
  resolved to *on* (the template default is off: 20 steps, cfg 3.5). The switch, primitive and
  math nodes (`ComfySwitchNode`, `PrimitiveInt/Float/Boolean`, `ComfyMathExpression`) are inlined
  as literals; what is left is core: `LoadImage`, `CLIPLoader` (`wan`), `VAELoader`,
  `CLIPTextEncode` ×2, `WanImageToVideo`, `UNETLoader` ×2, `LoraLoaderModelOnly` ×2,
  `ModelSamplingSD3` ×2 (shift 5), `KSamplerAdvanced` ×2 (euler/simple, 4 steps, cfg 1, high-noise
  steps 0–2 with leftover noise, low-noise 2–end), `VAEDecode`, `CreateVideo` (16 fps),
  `SaveVideo` (mp4/h264).
- Length 81 frames at 16 fps = 5.06 s (the template's 5 s duration, `floor(5 × 16 + 1)`).
- Negative prompt: the template's (Chinese) default, unchanged.
- Size: about the template's 640×640 pixels in the source's aspect (clamped to 9:16…16:9, sides
  multiples of 16): 480×848 for the 768×1344 portraits, 528×768 for 832×1216, 848×480 for
  1344×768, 640×640 for a square. `WanImageToVideo` scales the image to it and crops the centre.
- Graphs: [`graphs/wan22-i2v-14b-4step.api.json`](graphs/wan22-i2v-14b-4step.api.json) (the one
  shipped as `src/features/animateImage/workflows/animate-image.v1.json`, with neutral defaults in
  the bound fields) and [`graphs/wan22-i2v-14b-20step.api.json`](graphs/wan22-i2v-14b-20step.api.json)
  (the template's default path, for comparison only). Bound fields: image `1.image`, prompt
  `4.text`, width/height `6.width`/`6.height`, seed `13.noise_seed`.
- Node classes: every class exists in the pinned ComfyUI 0.42.0's `object_info` and in Cloud's
  (`$C/pin/object_info.json`, `$C/cloud/object_info.json`); no API or custom nodes.

## Models (all Apache-2.0, all in the lock schema)

| File | Directory | Repository @ commit | SHA-256 | Bytes |
| --- | --- | --- | --- | --- |
| `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` | diffusion_models | `Comfy-Org/Wan-2.2` @ `ee6f4a40737a995bf5818954cfce6d59443b0f04` | `6122e79d…5a6e42` | 14,294,742,832 |
| `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` | diffusion_models | same | `5471a457…fc21e` | 14,294,742,832 |
| `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` | loras | same | `d176c808…eff11e` | 1,226,977,424 |
| `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors` | loras | same | `024f21de…aab7f9` | 1,226,977,424 |
| `wan_2.1_vae.safetensors` | vae | same | `2fc39d31…48976b` | 253,815,318 |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | text_encoders | `Comfy-Org/Wan-Animate-2` @ `e7181fe…` (pinned identically to Motion Transfer's lock; same bytes as in `Comfy-Org/Wan-2.2`) | `c3355d30…204f68` | 6,735,906,897 |

Full hashes and URLs: `src/features/animateImage/workflows/models.lock` (from the Hugging Face
tree API's `lfs.oid`; one cross-checked against `x-linked-etag`). `Comfy-Org/Wan_2.2_ComfyUI_Repackaged`,
the URL the template names, now redirects to `Comfy-Org/Wan-2.2`. Licences from the Hugging Face
model cards: `Comfy-Org/Wan-2.2` apache-2.0; upstream `Wan-AI/Wan2.2-I2V-A14B` apache-2.0;
upstream of the LoRAs `lightx2v/Wan2.2-Lightning` apache-2.0. Weights to download on a self-host
pod: 31.3 GB for the five new files (the text encoder is already in Motion Transfer's lock).

## Inputs

- Repository samples: `src/features/characters/samples/characters/{maya,rosa,theo}.png`
  (768×1344, FLUX 3 Klein renders).
- Rendered for this gate with `character-generation.v1.json` through `comfy-run.ts`
  (`runs/input-*/run.json` holds each prompt and seed): a head-and-shoulders portrait holding a
  cup (832×1216), a golden retriever (1344×768), a sneaker product shot (1024×1024). Sheet:
  [`sheets/inputs.jpg`](sheets/inputs.jpg).
- The Foundation agent's `feature-coord/graphs/refs/ref-b-older-man-open-hands.png` (768×1344,
  FLUX 3 Klein, same workflow).

## Cases (Comfy Cloud, ComfyUI v0.43.0, through `comfy-run.ts` = the repository's SDK provider)

Frames in each sheet: 0, 16, 32, 48, 64, 80 (0 s, 1 s, 2 s, 3 s, 4 s, 5 s).

| Case | Source | Size | Action asked | Submit → done | Cost | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| [a-fullbody-wave](sheets/a-fullbody-wave.jpg) ([detail](sheets/a-fullbody-wave-detail.jpg), [MP4](a-fullbody-wave.mp4)) | Maya, full body, person | 480×848 | raise the right hand, wave, lower it | 35.8 s | 4.11 ¢ | Pass: identity, braids, hoodie, shoes kept; clear wave with five fingers; returns to the pose; no drift |
| [b-portrait-sip](sheets/b-portrait-sip.jpg) ([detail](sheets/b-portrait-sip-detail.jpg)) | portrait, person, hands on a cup | 528×768 | lift the cup, sip, lower it, smile | 30.3 s | 3.01 ¢ | Pass: both hands hold the cup through the sip, fingers plausible, face and freckles kept; the cup's handle is hidden by fingers mid-sip |
| [c-dog-wag](sheets/c-dog-wag.jpg) ([dense](sheets/c-dog-wag-dense.jpg)) | dog, animal, landscape | 848×480 | wag, tilt the head, lie down | 28.8 s | 3.05 ¢ | Pass: lies down smoothly with paws forward, coat and face kept; the tail wag and head tilt are barely visible (one action of three dominates) |
| [d-sneaker-turntable](sheets/d-sneaker-turntable.jpg) ([dense](sheets/d-sneaker-turntable-dense.jpg)) | sneaker, product, square | 640×640 | rotate on the pedestal | 34.6 s | 4.00 ¢ | Pass: about 180° rotation (side → toe → other side), colours, stripes and sole kept, no melting; the pedestal itself stays still |
| [e-fullbody-turnaround](sheets/e-fullbody-turnaround.jpg) ([dense](sheets/e-fullbody-turnaround-dense.jpg)) | Rosa, full body, person (difficult) | 480×848 | turn around to show the back, turn back | 34.8 s | 3.84 ¢ | Mixed: turns to about 135° with the head kept toward the camera (an over-the-shoulder pose), never a full back view; returns to face the camera; identity, jumpsuit, belt and sandals stable |
| [f-stylized-jump](sheets/f-stylized-jump.jpg) | Theo, 3D cartoon | 480×848 | crouch, jump with arms up, land, thumbs up | 27.3 s | 3.07 ¢ | Pass: every beat happens in order; style and outfit kept; slight hand softness at the top of the jump |
| [g-hands-clap](sheets/g-hands-clap.jpg) ([detail](sheets/g-hands-clap-detail.jpg)) | older man, hands interacting (difficult) | 480×848 | clap three times, rub the palms | 29.6 s | 2.97 ¢ | Pass with a caveat: the clapping/rubbing motion is clear and the face, blazer and watch are kept, but the moving hands are soft and the fingers merge at 480p |
| [h-turnaround-20step](sheets/h-turnaround-20step.jpg) | as e, template default (no LoRA, 20 steps, cfg 3.5) | 480×848 | as e | 175.4 s | 22.18 ¢ | Comparison only: turns further (shows the back) but invents an open back on the jumpsuit, the face drifts younger, and it does not turn back; 7× the cost |

Every output: 81 frames, 16 fps, 5.0625 s, H.264 High, yuv420p, `moov` before `mdat`
(ffprobe; 0.7–2.3 MB). Chromium 156 (Playwright) plays each one from `file://`: `readyState` 4,
`currentTime` advancing to 1.5 s after 1.5 s, the right `videoWidth`/`videoHeight`, no `error`.

## Latency and cost

- 4-step (shipped): submit → done 27.3–35.8 s (mean 31.6 s) for 5 s of video at about 410k
  pixels a frame; 2.97–4.11 ¢ a clip (mean 3.44 ¢), the Cloud balance delta `comfy-run.ts`
  records 20 s after the job.
- 20-step template default: 175 s, 22.18 ¢.
- Spent on this gate: 48.06 ¢ (seven 4-step clips 24.05 ¢, one 20-step clip 22.18 ¢, three
  input images 1.83 ¢), of the $10 budget.

## Not benchmarked, and why

- `video_wan2_2_5B_ti2v.json` (Wan 2.2 5B, also Apache-2.0): not run; the 14B 4-step result
  passed at a cost low enough that a smaller model was not needed.
- LTX 2.x (`video_ltx2_5_i2v.json`, `video_ltx2_3_i2v.json`): not run. The weights are from the
  `Lightricks` organisation under the LTX licence, outside the lock schema, and Wan already
  passed inside it.
- MiniMax H3 i2v: not run, same reason (licence not reviewed).

## Limitations

- One clear action per prompt works best; a prompt chaining three actions (case c) shows the
  biggest one.
- Full 180° turns are refused in effect: the 4-step model keeps the face toward the camera (case
  e). The 20-step path turns further but hallucinates unseen clothing and drifts the face.
- Fast hand-to-hand contact is soft at 480p (case g).
- The source is cropped to 9:16…16:9 around its centre.
- Self-host: not verified on self-host (no pod in this program). Peak VRAM not measured; the
  template's note quotes 83–84 % of a 24 GB RTX 4090D at 640×640 with fp8 weights.

## Reproduce

`$C` = `/Users/wojciechjelen/workspace/comfy-challenge/open-photon-wt/feature-coord`, `$W` = this
worktree. Each case (one job per call, holding the render lease):

```sh
node --experimental-strip-types $C/comfy-run.ts --repo $W --owner animate-image --label <case> \
  --graph docs/feature-evidence/animate-image/graphs/wan22-i2v-14b-4step.api.json \
  --out work/feature-evidence/animate-image/runs/<case> --image 1=<source image> \
  --set "4.text=<prompt>" --set 6.width=<w> --set 6.height=<h> --set 13.noise_seed=<seed>
ffprobe -v error -show_entries stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_frames:format=duration \
  -of compact <out>/17-0-*.mp4
ffmpeg -i <out>/17-0-*.mp4 -vf "select='eq(n\,0)+eq(n\,16)+eq(n\,32)+eq(n\,48)+eq(n\,64)+eq(n\,80)',scale=-2:240,tile=6x1" \
  -frames:v 1 sheets/<case>.jpg
```

The prompts, sizes, seeds and source files are in each `runs/<case>/run.json` (`sets`, `images`),
with the Cloud job id, timings and balance delta. Full-resolution videos stay in the ignored
`work/feature-evidence/animate-image/`.
