# Open Photon

[![CI](https://github.com/WojciechJelen/open-photon/actions/workflows/ci.yml/badge.svg)](https://github.com/WojciechJelen/open-photon/actions/workflows/ci.yml)

Turn a short motion clip and a character image into a video of that character doing
the same motion. Open Photon runs the open-weights Wan Animate 2 workflow on Comfy
Cloud or your own GPU, with side-by-side playback, downloadable results, share
pages and reproducible recipes.

Built with TanStack Start, React, Tailwind, shadcn, SQLite and the Comfy SDK.
Browsing samples is public; uploads and new generations require an access code.
New renders use your Comfy Cloud credits or your self-hosted GPU.

## Getting started

### Choose a rendering backend

Save **one** of these configurations in `.env`:

**Comfy Cloud:** create a [Comfy Cloud](https://cloud.comfy.org) API key with workflow
access and credits.

```dotenv
COMFY_API_KEY=your-cloud-key
```

**Runpod:** deploy the [Open Photon template](https://console.runpod.io/deploy?template=iqcvzqgt1q)
on an NVIDIA GPU with **32 GB VRAM or more** and a **CUDA 13-compatible driver**.
Set `PROXY_TOKEN` to a long random secret. The template supplies the GPU image,
port `8189` and persistent storage at `/workspace`. Wait for `Serving the Comfy API v2`
in the logs; the first boot downloads approximately 26 GB of models. Then save:

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

Enter the printed access code in the app. `100` is its generation allowance.

### Run the containerized app

Install Docker and create `.env` with the backend settings above. No repository
clone, Node installation or local build is needed. The same published app image
supports both backends on Linux AMD64 and ARM64:

```sh
docker run -d --name open-photon --init \
  --env-file .env \
  -p 127.0.0.1:3030:3000 \
  -v open-photon-data:/app/data \
  ghcr.io/wojciechjelen/open-photon:0.1.0
```

Open [localhost:3030](http://localhost:3030), then create an access code:

```sh
docker exec open-photon node scripts/mint-code.mjs me 100
```

The volume keeps results and access codes across container replacement. From a
source checkout, you can instead use `docker compose up -d` and
`docker compose exec app node scripts/mint-code.mjs me 100` with the same `.env`.
Compose uses its own persistent volume.
