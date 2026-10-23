# Open Photon

[![CI](https://github.com/WojciechJelen/open-photon/actions/workflows/ci.yml/badge.svg)](https://github.com/WojciechJelen/open-photon/actions/workflows/ci.yml)

Turn a short motion clip and a character image into a video of that character doing
the same motion. Open Photon runs the open-weights Wan Animate 2 workflow on Comfy
Cloud or your own GPU, with side-by-side playback, two downloads per take (the result,
and a vertical 9:16 side-by-side of the source clip and the result with its audio,
stitched with FFmpeg when the take finishes, for TikTok, Reels and X), share pages and
reproducible recipes. Characters come from a workspace library: describe
one and render it with the open-weights FLUX 3 Image Klein (`/characters/new`), or
upload a photo with the person's consent, then find and animate it from
`/characters`.

Built with TanStack Start, React, Tailwind, shadcn, SQLite and the Comfy SDK.
Browsing samples is public; uploads and new generations require an access code.
Opened a link that already contains a code? You're in.
New renders use your Comfy Cloud credits or your self-hosted GPU.

An unfinished experiment in pinning performance beats, not part of the app, lives in
`src/features/motion-score/`.

## Getting started

### Choose a rendering backend

Save **one** of these configurations in `.env`:

**Comfy Cloud:** create a [Comfy Cloud](https://cloud.comfy.org) API key with workflow
access and credits.

```dotenv
COMFY_API_KEY=your-cloud-key
```

**Runpod:** deploy the [Open Photon template](https://console.runpod.io/deploy?template=iqcvzqgt1q)
on an NVIDIA GPU with a **CUDA 13-compatible driver**. **48 GB VRAM is recommended**:
image `0.2.0` on an A40 peaked at 38,935 MiB for a 5-second Motion Transfer take and
10,653 MiB for a character image (whole-device `nvidia-smi` readings while each ran). Image
`0.1.0` also passed a 5-second render on an RTX 5090 32 GB, peaking at 31,426 MiB with little
headroom.
Set `PROXY_TOKEN` to a long random secret, and `HF_TOKEN` to a Hugging Face token of an account
that accepted the FLUX Kommunity License on
[black-forest-labs/flux-3-image-klein-comfy](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy)
(character generation's weights are gated there; without it the first boot stops). The template
supplies the GPU image, port `8189` and an 80 GB persistent volume at `/workspace`. Wait for
`Serving the Comfy API v2` in the logs; the first boot downloads 43.4 GB (40.4 GiB) of models to
that volume: 25.6 GB for Motion Transfer and 17.7 GB for character generation (FLUX 3 Image Klein
distilled int8, its Qwen3-VL text encoder, its prompt upsampler and the FLUX 2 VAE), which leaves
about 36 GB for ComfyUI's inputs and outputs (on the A40 test, the download took 5 minutes and
the API served 9 minutes after the pod was created; a restart downloads nothing but re-checks
every file, about 4 minutes). A volume of your own needs at least 50 GB. The GPU
runs one job at a time, so it must fit the largest workflow, Motion Transfer; the figures above
are its own. Then save:

```dotenv
COMFY_BASE_URL=https://POD_ID-8189.proxy.runpod.net
COMFY_PROXY_TOKEN=the-same-secret-as-PROXY_TOKEN
```

Leave `COMFY_API_KEY` unset for Runpod. Stop the pod when unused; terminate it to
remove its pod storage too. Separately created network volumes continue billing.

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

<a id="run"></a>

### Run the containerized app

Install Docker and create `.env` with the backend settings above. No repository
clone, Node installation or local build is needed. The same published app image
supports both backends on Linux AMD64 and ARM64:

```sh
docker run -d --name open-photon --init \
  --env-file .env \
  -p 127.0.0.1:3030:3000 \
  -v open-photon-data:/app/data \
  ghcr.io/wojciechjelen/open-photon:0.2.0
```

Open [localhost:3030](http://localhost:3030), then create an access code:

```sh
docker exec open-photon node scripts/mint-code.mjs me 100
```

The volume keeps results and access codes across container replacement. From a
source checkout, you can instead use `docker compose up -d` and
`docker compose exec app node scripts/mint-code.mjs me 100` with the same `.env`.
Compose uses its own persistent volume.

To fill the home page's result wall, render every sample motion × sample character
once and mark the takes pre-rendered (public, and free to reopen without a code). With
the app running, mint a code for at least that many generations, then:

```sh
BASE_URL=http://127.0.0.1:3000 ACCESS_CODE=<code> node scripts/prerender-samples.mjs
```

Run it where the database is (in the container: `docker exec open-photon …`). Each
take is a Wan Animate 2 render billed to your backend; a second run submits nothing.

## Models and licences

| Feature | Model | Licence |
| --- | --- | --- |
| Motion Transfer | Wan Animate 2 and its encoders | Apache-2.0 |
| Character generation | FLUX 3 Image Klein distilled (int8) | [FLUX Kommunity License v1.0](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/blob/main/LICENSE.md) |
| Character generation | Qwen3-VL-4B text encoder, FLUX 3 prompt upsampler, FLUX 2 VAE | Apache-2.0 |

FLUX 3 Image Klein's weights are open but not under an OSI licence. The FLUX Kommunity License
grants non-commercial use (§2.a(i)); running it in production to generate outputs for commercial
use is granted only to Qualifying Users (§2.a(ii): you and your affiliates under US$5M gross
annualized revenue), and only if you filter outputs for unlawful, unsafe or infringing content or
review them before distribution (§2.e(i)), and disclose that outputs are AI-generated to the
extent applicable law requires (§2.e(ii)). Open Photon itself implements neither filtering nor a
disclosure. Read the licence before deploying. Exact files, revisions, hashes and
the workflow's origin: `src/features/characterBuilder/workflows/README.md`.
