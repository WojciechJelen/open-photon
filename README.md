# Open Photon

[![CI](https://github.com/WojciechJelen/open-photon/actions/workflows/ci.yml/badge.svg)](https://github.com/WojciechJelen/open-photon/actions/workflows/ci.yml)

Open Photon is an open-weights image and video studio: every tool runs a ComfyUI workflow of
open-weights models on Comfy Cloud or your own GPU, keeps a reproducible recipe and can publish a
share page. Its headline tool turns a short motion clip and a character image into a video of
that character doing the same motion with Wan Animate 2, with side-by-side playback and two
downloads per take (the result, and a vertical 9:16 side-by-side of the source clip and the result
with its audio, stitched with FFmpeg when the take finishes, for TikTok, Reels and X). Characters
come from a workspace library: describe one and render it with FLUX 3 Image Klein, or upload a
photo with the person's consent; then photograph, turn, storyboard or animate it.

- **Motion Transfer** (`/motionTransfer`): a motion clip and a character image into a video of
  the character doing that motion; Wan Animate 2.
- **Motion presets** (`/presets`): start a take from a ready-made motion, look and seed, each shown
  by a real example render: add a character and generate; Wan Animate 2.
- **Explore** (`/explore`): the finished sample takes with their source, result and recipe; remake
  any of them with your own character.
- **Batch variations** (`/batches`): one Motion Transfer shot with two or four seeds, or on two to
  six characters, rendered at once and compared side by side; Wan Animate 2.
- **Animate Image** (`/animate`): an uploaded image or a library character and a described action
  into a 5 s video, no motion clip needed; Wan 2.2 14B image-to-video.
- **Character builder** (`/characters/new`): describe a character, refine the caption the prompt
  upsampler writes, and render a full-body image; FLUX 3 Image Klein.
- **Character library** (`/characters`): find, favorite and rename the workspace's characters,
  generated or uploaded, and animate any of them.
- **Character Photoshoot** (`/photoshoot`): a library character in a studio, street, editorial or
  outdoor setting, four poses and lights, same face and outfit; FLUX 3 Image Klein reference edit.
- **Shots & Angles** (`/angles`): a character from the front, three-quarter, profile and close up,
  each view rendered anew; Qwen-Image-Edit-2511 with the Multiple-Angles and Lightning LoRAs.
- **Storyboard** (`/storyboards`): a character and a short sequence into four editable scene
  cards; Qwen3.5-4B writes the scenes, FLUX 3 Image Klein edits the character into each.
- **Product Studio** (`/product-studio`): a product photo into a packshot, a lifestyle scene or an
  ad visual around the product's own pixels; BiRefNet mattes it, FLUX 3 Image Klein renders the
  scene.
- **Sprite Forge** (`/sprites`): a library character into an 8-direction walk-cycle sprite sheet,
  HD and pixel art, each an RGBA PNG atlas with its Aseprite JSON and a WASD playground;
  Qwen-Image-Edit-2511 draws five directions, Wan 2.2 14B image-to-video walks them, BiRefNet and
  Sprite Forge's own ComfyUI nodes cut the loops and pack the atlases (sheets need the
  [self-hosted backend](#choose-a-rendering-backend)).

**Try it:** [open-photon-staging.up.railway.app](https://open-photon-staging.up.railway.app/). The
home page, the samples and every share page open without a code. Judges: use the link in the
submission form; it signs you in and opens the character builder (`/characters/new`).

<p align="center">
  <img src="docs/readme/maya-street-dance.gif" height="220" alt="A take side by side: the Street dance driving clip on the left, the Maya character doing the same dance on the right">
  <img src="docs/readme/maya-character-and-take.jpg" height="220" alt="Left: the Maya character as FLUX 3 Image Klein rendered her from a description; right: a frame of her Wan Animate 2 take">
</p>
<p align="center"><sub>Left: a take's side-by-side download, driving clip | result (cropped, as a GIF).
Right: a character FLUX 3 Image Klein rendered from a short description and three controls,
expanded by the prompt upsampler, beside a frame of
Wan Animate 2 animating her. Both from a pre-rendered sample take;
<a href="docs/readme/README.md">how they were cut</a>.</sub></p>

## Getting started

<a id="run"></a>

### Run the containerized app

With Docker installed, put one backend in `.env` ([Comfy Cloud or Runpod](#choose-a-rendering-backend)), then:

```sh
docker run -d --name open-photon --init --env-file .env -p 127.0.0.1:3030:3000 \
  -v open-photon-data:/app/data ghcr.io/wojciechjelen/open-photon:0.3.0
# Open http://localhost:3030 once, then print an access code:
docker exec open-photon node scripts/mint-code.mjs me 100
```

Volumes, Compose, filling the result wall and a run from source: [Setup](#setup).

## Numbers

One 5-second 480×848 Motion Transfer take, one caption, one 768×1344 character image, and
Sprite Forge's five views and two 8-direction sheets:

| Workflow | Backend | Submit → done | Peak VRAM | Cost |
| --- | --- | --- | --- | --- |
| Motion Transfer | Comfy Cloud | 70.6–115.7 s (6 takes) | — | ≈ 8.2 ¢ (17.3 credits) |
| Motion Transfer | RTX 5090 32 GB | 158.7 s (Oct 21); 167.8 s (`0.1.0`) | 31,066; 31,426 MiB | pod time |
| Motion Transfer | A40 48 GB | 255.9 s (`0.2.0`); 149.1 s (`0.1.0`) | 38,935 MiB (`0.2.0`) | 255.9 s × $0.59/h ≈ $0.04 |
| FLUX 3 caption | Comfy Cloud | 5.0 s | — | ≈ 0.08 ¢ |
| FLUX 3 caption | A40 48 GB | 26.6 s | 6,601 MiB | pod time |
| FLUX 3 image | Comfy Cloud | 14.3 s | — | ≈ 0.8 ¢ |
| FLUX 3 image | A40 48 GB | 31.9 s | 10,653 MiB | pod time |
| Sprite Forge, five views | A40 48 GB | 257.2 s total; 188.3 s cold first view, 15.1–17.5 s thereafter | 45,249 MiB | ≈ $0.04 compute |
| Sprite Forge, sheet Quick | A40 48 GB | 416.3 s | 43,169 MiB | ≈ $0.07 compute |
| Sprite Forge, sheet Best of 3 | A40 48 GB | 825.8 s | 39,241 MiB | ≈ $0.14 compute |

Sources: Cloud Motion Transfer [DEV-280](CHECKLIST.md#sample-matrix-and-result-wall-dev-280), its direct-submit execution [CHECKLIST 1.6](CHECKLIST.md#phase-1--the-workflow-as-data); RTX 5090 [CHECKLIST 8.3](CHECKLIST.md#phase-8-open-weights-proof) (Oct 21) and the [Oct 23 follow-up](CHECKLIST.md#deployment-evidence-after-the-docker-simplification); A40 `0.2.0` and its pod rate the [self-host proof](docs/selfhost-proof-2026-10-23/README.md); A40 `0.1.0` [CHECKLIST](CHECKLIST.md#deployment-evidence-after-the-docker-simplification); FLUX 3 on Cloud the [character workflows README](src/features/characterBuilder/workflows/README.md#measurements-comfy-cloud-2026-10-23).

Cloud Motion Transfer times are the six sample takes through the app, side-by-side stitch
included; a direct submit's ComfyUI execution took 64.9 s. Cloud cost is the account balance drop
over the six takes, per take; Cloud VRAM is not observable. A40 VRAM is the whole-device `nvidia-smi` peak while
the job ran. The RTX 5090 (Oct 21) and A40 `0.2.0` jobs were each the first of their models on
the pod, so model loading is included. The whole A40 run (boot, model download, three jobs,
restart) cost about $0.21 of pod time.

Sprite Forge measurements come from the [Oct 30 self-host proof](docs/selfhost-proof-2026-10-30-sprite-forge/README.md).
Its first view and Quick sheet loaded their models cold; Best of 3 followed with warm caches.
Peaks are whole-device one-second samples within each submission-to-completion interval.
Both sheets have 64 frames in eight directions, an RGBA HD atlas and a pixel atlas with JSON.
All seven generations passed their recipe and output checks. Best of 3 improved the back
loop but had worse seam ratios than Quick in the other base directions, so the loop-quality
comparison failed. The temporary deployment was deleted; pod and disk cost was about $0.78
including the full cold boot, with a few cents estimated for Railway.

## Setup

Browsing samples is public; uploads and new generations require an access code.
Opened a link that already contains a code? You're in.
New renders use your Comfy Cloud credits or your self-hosted GPU.

### Choose a rendering backend

Save **one** of these configurations in `.env`:

**Comfy Cloud:** create a [Comfy Cloud](https://cloud.comfy.org) API key with workflow
access and credits.

```dotenv
COMFY_API_KEY=your-cloud-key
```

Comfy Cloud does not install custom nodes, so Sprite Forge on Cloud draws a character's five
direction views but cannot forge the sheet: the button is disabled and the API answers 422
`selfhost_required`. Sheets run its node pack on the self-hosted backend
([Sprite Forge README](src/features/spriteForge/README.md#self-host)).

**Runpod:** deploy the [Open Photon template](https://console.runpod.io/deploy?template=iqcvzqgt1q)
on an NVIDIA GPU with a **CUDA 13-compatible driver**. **48 GB VRAM is recommended** for Motion
Transfer (peaks per workflow in [Numbers](#numbers)); 32 GB passed with little headroom.
Set `PROXY_TOKEN` to a long random secret, and `HF_TOKEN` to a Hugging Face token of an account
that accepted the FLUX Kommunity License on
[black-forest-labs/flux-3-image-klein-comfy](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy)
(character generation's weights are gated there; without it the first boot stops). The template
supplies the GPU image, port `8189` and a 170 GB persistent volume at `/workspace`. Wait for
`Serving the Comfy API v2` in the logs; the first boot downloads every feature's lock, 136.1 GB
(126.8 GiB, 21 files) of models, to that volume, each shared file once: 25.6 GB for Motion
Transfer; 17.7 GB for FLUX 3 Image Klein (distilled int8, its Qwen3-VL text encoder, its prompt
upsampler and the FLUX 2 VAE), shared by character generation, Photoshoot, Storyboard cards and
Product Studio; 9.3 GB for Storyboard's Qwen3.5-4B scene writer; 51.6 GB for Shots & Angles
(Qwen-Image-Edit-2511 bf16 alone is 40.9 GB); 31.3 GB for Animate Image (its UMT5-XXL text encoder
is Motion Transfer's); and 0.4 GB for Product Studio's BiRefNet. That leaves about 34 GB for
ComfyUI's inputs and outputs. On the A40 test of `0.2.0`, the then 43.4 GB of Motion Transfer and
character generation took 5 minutes to download and the API served 9 minutes after the pod was
created; a restart downloaded nothing but re-checked those nine files in about 4 minutes.
Oct 30's cold Sprite Forge boot installed all 136.1 GB and served the API 37 minutes 6 seconds
after pod creation, including image pull. A full-volume restart remains unmeasured. A volume
of your own needs at least 140 GB. The GPU runs one job at a time, so it must fit the largest
workflow: measured peaks exist
for Motion Transfer, FLUX 3 and Sprite Forge ([Numbers](#numbers)); Shots & Angles, Animate Image,
Storyboard's scene split and Product Studio have not run as standalone workflows on a self-hosted GPU, so
their peaks are unmeasured. Sprite Forge reached 45,249 MiB on the A40, with only 819 MiB of
reported capacity remaining. Sprite Forge's sheets need its custom node pack, which
`selfhost/Dockerfile` copies into the image (boot fails if it is missing); an image built before
Sprite Forge lacks it and must be rebuilt. Then save:

```dotenv
COMFY_BASE_URL=https://POD_ID-8189.proxy.runpod.net
COMFY_PROXY_TOKEN=the-same-secret-as-PROXY_TOKEN
```

Leave `COMFY_API_KEY` unset for Runpod. Stop the pod when unused; terminate it to
remove its pod storage too. Separately created network volumes continue billing.
Each input file has 10 minutes to reach the backend (enough for a 128 MiB clip at about
1.8 Mbit/s); on a slower uplink, raise `COMFY_UPLOAD_TIMEOUT_MS` (milliseconds, up to an hour).

### Run locally from source

Install Node.js 24+, npm 11.6.2 and FFmpeg (including `ffprobe`), then:

```sh
git clone https://github.com/WojciechJelen/open-photon.git
cd open-photon
npm ci
cp .env.example .env
# Edit .env with the backend settings above.
npm run dev
```

Open [localhost:3030](http://localhost:3030). Once the app has initialized its
database, run this in another terminal from the repository directory:

```sh
node --env-file=.env scripts/mint-code.mjs me 100
```

Enter the printed access code in the app. `100` is its generation allowance. A link
`/access?code=<code>&next=/characters/new` signs in on opening and lands on that page.

### Container notes

The published app image runs either backend on Linux AMD64 and ARM64; it needs no repository
clone, Node installation or local build. The volume keeps results and access codes across
container replacement. From a
source checkout, you can instead use `docker compose up -d` and
`docker compose exec app node scripts/mint-code.mjs me 100` with the same `.env`.
Compose uses its own persistent volume.

To fill the home page's result wall and Explore (`/explore`), render every sample motion ×
sample character once and mark the takes pre-rendered (public, and free to reopen without a
code). Until then both are empty (Explore says so and links Motion Transfer); nothing fills
them at boot. With the app running, mint a code for at least that many generations, then:

```sh
BASE_URL=http://127.0.0.1:3000 ACCESS_CODE=<code> node scripts/prerender-samples.mjs
```

Run it where the database is (in the container: `docker exec open-photon …`). Each
take is a Wan Animate 2 render billed to your backend; a second run submits nothing. Every take
it marks is listed in Explore at once, with its recipe and "Make this with my character".

## Every model and tool

Models, by workflow (each pinned by file, revision and SHA-256 in its feature's lock,
[below](#open-weights); a file two workflows share is listed once):

Motion Transfer, Motion presets, Explore remakes and Batch variations:

- **Wan Animate 2** (int8, `wan_animate_2_int8_convrot`): the video model; moves the character
  image the way the person in the driving clip moves.
- **lightx2v distillation LoRA** (`lightx2v_I2V_14B_480p_cfg_step_distill_rank64`): lets Wan
  Animate 2 render in 6 steps at CFG 1 instead of a full sampling schedule.
- **UMT5-XXL** (fp8): Wan's text encoder; encodes the take's prompt, and Animate Image's action.
- **CLIP-ViT-H** (`clip_vision_h`): encodes the character image so the take keeps its identity.
- **Wan 2.1 VAE** (`Wan2_1_VAE_bf16`): encodes the clip and character into Wan's latent space and
  decodes the result to frames.

Animate Image:

- **Wan 2.2 I2V 14B high-noise expert** (fp8 scaled, `wan2.2_i2v_high_noise_14B_fp8_scaled`): the
  video model's first expert; adds the noise and denoises the first 2 of 4 steps from the still and
  the action prompt.
- **Wan 2.2 I2V 14B low-noise expert** (fp8 scaled, `wan2.2_i2v_low_noise_14B_fp8_scaled`): the
  second expert; continues from step 2 without new noise to the finished latent.
- **Wan 2.2 lightx2v 4-step LoRAs** (`wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise` and
  `…_low_noise`): one per expert; let the pair render in 4 steps at CFG 1.
- **Wan 2.1 VAE** (`wan_2.1_vae`, the Wan 2.2 repository's copy): encodes the still and decodes
  the 81 frames.

Character builder, Photoshoot, Storyboard cards and Product Studio:

- **FLUX 3 Image Klein** (distilled, int8): the image model, 16 steps; renders a caption into the
  character image, edits library characters from their image (Photoshoot, Storyboard cards) and
  renders the scene around a matted product (Product Studio).
- **Qwen3-VL-4B** (int8): FLUX 3's text encoder; turns the caption into the conditioning the
  image model reads.
- **Qwen3.5-9B FLUX 3 prompt upsampler** (w4a8): expands a short description into the full
  caption the user reviews and may edit, and rewrites a Photoshoot prompt from the prompt and its
  reference image.
- **FLUX 2 VAE**: encodes reference images for FLUX 3 and decodes its latents to the PNG.

Storyboard:

- **Qwen3.5-4B** (bf16, `qwen3.5_4b_bf16`): through core `TextGenerate`, splits the user's
  sequence into the four scenes the cards render.

Shots & Angles:

- **Qwen-Image-Edit-2511** (bf16, `qwen_image_edit_2511_bf16`): the image-edit model; re-renders
  the reference character from the camera view the prompt names.
- **Multiple-Angles LoRA** (fal, `qwen-image-edit-2511-multiple-angles-lora`): teaches the edit
  model the camera-view vocabulary the prompts use (`<sks> front-right quarter view …`).
- **Qwen-Image-Edit-2511 Lightning LoRA** (lightx2v, 4 steps, bf16): lets it render in 4 steps at
  CFG 1.
- **Qwen2.5-VL-7B** (fp8 scaled): Qwen-Image-Edit's text encoder; encodes the view prompt
  together with the reference image.
- **Qwen image VAE**: encodes the reference into the latent and decodes the new view.

Product Studio:

- **BiRefNet** (`birefnet`): removes the product photo's background, so FLUX 3 regenerates only
  the scene and the product's own pixels are pasted back.

Sprite Forge has no file of its own: Shots & Angles' Qwen-Image-Edit-2511 files and LoRAs draw
the five direction views, Animate Image's Wan 2.2 I2V experts and 4-step LoRAs walk each view in
place (the view as both first and last frame), and Product Studio's BiRefNet mattes the views and
the walk frames.

Tools:

- **ComfyUI 0.42** + **comfy-api-proxy** (self-host): run the workflow graphs on your GPU and
  serve them as the Comfy API v2 behind a bearer token.
- **Comfy Cloud** + **`@comfyorg/sdk`**: run the same graphs on Comfy's GPUs; the SDK uploads
  inputs, submits, follows progress and downloads outputs for both backends.
- **FFmpeg**: probes and trims uploaded clips, cuts posters, and stitches the 9:16 side-by-side
  download.
- **Node 24** + **`node:sqlite`**: the server, and the database of generations, recipes, assets and
  access codes.
- **TanStack Start**: the React app, its routes, server functions and server-side rendering.
- **Runpod**: the GPU pod template that runs the self-host image.
- **Railway**: hosts the live app.

## Open weights

The Open Weights Only claim rests on two things: no partner nodes and no closed APIs. Every graph
uses ComfyUI core nodes (Sprite Forge's sheet also its own node pack, in this repository), and
every file it loads is pinned to an immutable Hugging Face revision URL and SHA-256 in its
feature's lock, eight locks and 21 distinct files in all:
[`motionTransfer`](src/features/motionTransfer/workflows/models.lock) (five files),
[`characterBuilder`](src/features/characterBuilder/workflows/models.lock) (four),
[`imageEdit`](src/features/imageEdit/workflows/models.lock) (the character builder's four, byte for
byte; Photoshoot and Storyboard cards),
[`productStudio`](src/features/productStudio/workflows/models.lock) (three of those and BiRefNet),
[`storyboard`](src/features/storyboard/workflows/models.lock) (one),
[`angles`](src/features/angles/workflows/models.lock) (five),
[`animateImage`](src/features/animateImage/workflows/models.lock) (six, its UMT5-XXL pinned
exactly as Motion Transfer's) and
[`spriteForge`](src/features/spriteForge/workflows/models.lock) (twelve: the `angles` five, the
`animateImage` six and BiRefNet, each pinned exactly as there). `npm run check:models` fails when
a workflow loads a file no lock pins, a pin has a mutable or unapproved URL or a bad hash, or two
features pin one file differently; `npm run check:open-weights` scans every feature's workflows,
subgraphs included, for partner and API nodes ([`scripts/forbidden-nodes.json`](scripts/forbidden-nodes.json)).
CI runs both on every pull request and push to `main`, and its server tests plant a partner node
([`tests/fixtures/partner-node.json`](tests/fixtures/partner-node.json)) that the check must
reject by name ([`tests/open-weights.test.ts`](tests/open-weights.test.ts)). Motion Transfer and
the FLUX 3 character workflows have run on your own GPU:
[`docs/selfhost-proof-2026-10-23/`](docs/selfhost-proof-2026-10-23/README.md) holds the A40 run's
boot log, GPU memory samples, recipes, outputs and `verify-selfhost.mjs` report, and Motion
Transfer also rendered on an RTX 5090 ([CHECKLIST 8.3](CHECKLIST.md#phase-8-open-weights-proof)).
Shots & Angles, Animate Image, the Photoshoot and Storyboard edits, Storyboard's scene split,
Product Studio have run only on Comfy Cloud so far; their node classes
exist at the self-host image's ComfyUI 0.42.0, but they have not run on a self-hosted GPU and
their VRAM is unmeasured. Sprite Forge's five views and complete Quick and Best of 3 sheets
ran on a self-hosted A40. The [Oct 30 proof](docs/selfhost-proof-2026-10-30-sprite-forge/README.md)
records their recipes, outputs, memory peaks and the failed Best of 3 versus Quick quality
comparison. Sprite Forge's sheet cannot run on Cloud because it needs the custom node pack.
Open does not mean OSI here: the FLUX 3 Image Klein transformer is open weights under the FLUX
Kommunity License, not an OSI licence; BiRefNet is MIT and every other file is Apache-2.0.

## Models and licences

| Feature | Model | Licence |
| --- | --- | --- |
| Motion Transfer | Wan Animate 2 and its encoders | Apache-2.0 |
| Animate Image | Wan 2.2 I2V 14B high- and low-noise experts, their lightx2v 4-step LoRAs, Wan 2.1 VAE (UMT5-XXL as Motion Transfer) | Apache-2.0 |
| Character generation, Photoshoot, Storyboard cards, Product Studio | FLUX 3 Image Klein distilled (int8) | [FLUX Kommunity License v1.0](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/blob/main/LICENSE.md) |
| Character generation, Photoshoot, Storyboard cards, Product Studio | Qwen3-VL-4B text encoder, FLUX 3 prompt upsampler, FLUX 2 VAE | Apache-2.0 |
| Storyboard | Qwen3.5-4B scene writer | Apache-2.0 |
| Shots & Angles | Qwen-Image-Edit-2511 (bf16), Qwen2.5-VL-7B text encoder, Qwen image VAE | Apache-2.0 |
| Shots & Angles | Multiple-Angles LoRA (fal), Qwen-Image-Edit-2511 Lightning LoRA (lightx2v) | Apache-2.0 |
| Product Studio | BiRefNet | MIT |

FLUX 3 Image Klein's weights are open but not under an OSI licence. The FLUX Kommunity License
grants non-commercial use (§2.a(i)); running it in production to generate outputs for commercial
use is granted only to Qualifying Users (§2.a(ii): you and your affiliates under US$5M gross
annualized revenue), and only if you filter outputs for unlawful, unsafe or infringing content or
review them before distribution (§2.e(i)), and disclose that outputs are AI-generated to the
extent applicable law requires (§2.e(ii)). What Open Photon does: it discloses (a generated image
is labelled AI-generated wherever the app shows it, an image's share page is titled "AI-generated
image", image downloads are named `ai-generated-…`, and a Motion Transfer share page says when its
character is AI-generated); it runs no content filter; and a generated character image stays
private to the workspace until its owner checks it and chooses "Publish & copy link", which gives
it its public share page. Whether that is enough for your deployment, and whether you are a
Qualifying User, is yours to judge: read the licence before deploying. Exact files, revisions,
hashes and the workflow's origin: `src/features/characterBuilder/workflows/README.md`.

## How it was built

[`AGENTS.md`](AGENTS.md) is the rulebook the coding agents worked to (layout, import boundaries,
the generation queue, toolchain). [`CHECKLIST.md`](CHECKLIST.md) is the build log: every step with
its evidence, including each paid render and what it cost.

An unfinished experiment in pinning performance beats, not part of the app, lives in
`src/features/motion-score/`.
