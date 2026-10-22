# Setup

The operator guide: run Open Photon on Comfy Cloud or on your own GPU, switch between them, every variable, and what to do when something fails.

## What you are choosing

The app speaks one protocol, the Comfy API v2 through `@comfyorg/sdk`. It renders on one of two targets: **Comfy Cloud** (the default) or **your own infra**, a ComfyUI behind Comfy-Org's [comfy-api-proxy](https://github.com/Comfy-Org/comfy-api-proxy). Two variables choose: `COMFY_BASE_URL` and `COMFY_API_KEY` (table: [Environment reference](#environment-reference)). The code path is the same for both; only the URL and the bearer change.

## Prerequisites

- To run the app: Docker with Compose, or Node 24+, npm 11.6.2 (`npm install --global npm@11.6.2`) and FFmpeg with libx264 (uploads are probed and trimmed with `ffprobe`/`ffmpeg`; the server tests and output checks run them too). Docker and CI use the npm version in `package.json` `packageManager`.
- To run `npm run check:comfy` and the other repository scripts: Node 24+ and `npm ci` on the machine you run them from, even when the app itself runs in Docker (the app image carries only `scripts/mint-code.mjs`).
- To render, one of:
  - a Comfy Cloud API key whose account has access to workflow generation and enough credits (signing in alone does not grant that access);
  - a GPU host: one x86_64 NVIDIA GPU with at least 32 GB VRAM and a CUDA 13 driver (sizes: [Sizing](#sizing)).

## Run on Comfy Cloud (default)

1. Create `.env` and set the key. `.env` is ignored by Git and by the Docker context; supply the key only at runtime.

   ```sh
   cp .env.example .env    # then set COMFY_API_KEY in .env; leave COMFY_BASE_URL unset
   ```

2. Check that Cloud answers and accepts the key (reads the environment, then `.env`):

   ```sh
   npm ci
   npm run check:comfy
   # comfy target=cloud base=https://cloud.comfy.org auth=bearer
   # OK: reachable and authorized (an unknown job id is 404 not found)
   ```

   Any other output: [Troubleshooting](#checkcomfy-outcomes).

3. Start the app:

   ```sh
   docker compose up --build
   ```

   Before it listens, the server logs `{"auth":"bearer","base":"https://cloud.comfy.org","event":"comfy.target","target":"cloud"}`. The app is on <http://localhost:3030>. Compose passes `.env` to the container, so every optional variable in [`.env.example`](.env.example) applies when uncommented, and stores the database on the `sqlite-data` volume.

4. Mint an access code once the app is up, and enter it when the app asks:

   ```sh
   docker compose exec app node scripts/mint-code.mjs me 20
   ```

   Label, quota, revocation: README ["Access codes"](README.md#access-codes).

Cost: each render spends Comfy Cloud credits; the measured figure per 5 s 480×848 render is in README ["Credits"](README.md#credits).

Concurrency: `IN_FLIGHT_MAX` (default 1) caps generations in flight across the whole app, not per feature. 1 matches Comfy Cloud Standard's one concurrent workflow; raise it only if your plan allows more. Over the cap, Generate answers 503 `queue_full` (README ["Rate limits and the in-flight cap"](README.md#rate-limits-and-the-in-flight-cap)).

Verified on 2026-10-21 with two fresh GitHub clones and separate empty volumes on an existing Colima host: sample selection, clip upload and trim, consented photo upload, real Comfy generation, compare playback and MP4 download, with no app changes. Timings, credits and the Docker cache used: [docs/fresh-clone-2026-10-21.log](docs/fresh-clone-2026-10-21.log).

### Without Compose

```sh
docker build -t open-photon:latest .
docker run -d --name open-photon --init \
  --env-file .env \
  -p 127.0.0.1:3030:3000 \
  --mount type=volume,source=open-photon-data,target=/app/data \
  open-photon:latest
docker exec open-photon node scripts/mint-code.mjs me 20
```

For Colima, add `--context colima` after `docker`. Stop the running app before building on a small Docker VM. This volume (`open-photon-data`) is not the Compose one (`sqlite-data`); keep whichever holds your render data when replacing containers.

Build and run natively: ARM64 on Apple Silicon, AMD64 on x86 hosts. Compose pins `linux/amd64`, so on Apple Silicon it builds and runs emulated. CI builds the AMD64 image on an x86 runner. For an explicit cross-platform check, add `--platform linux/amd64` to both build and run, with a separate image tag and container. Earlier emulated runs had a route-generator segmentation fault and inconsistent memory measurements; use native runs for memory checks.

### Without Docker

```sh
npm ci
npm run dev                            # http://localhost:3030
node scripts/mint-code.mjs me 20       # after the first page load has created data/app.sqlite
```

`npm run dev` and `npm run start` (after `npm run build`) read the process environment; export the variables in the shell before starting.

## Run on your own infra: RunPod example

The GPU side is one image, [`selfhost/`](selfhost/): ComfyUI `7a28332` (0.42.0) behind `comfy-api-proxy` 0.1.6 on port 8189, with every feature's locked weights. What it does at boot, its known risks and how to verify a render: [docs/selfhost.md](docs/selfhost.md).

1. Build and push the image from the repository root. The image is public on GHCR under the repository's owner, tagged with the repository commit it was built from (the tag identifies the ComfyUI pin and every feature's lock together; a feature that adds a workflow changes the image without changing `selfhost/Dockerfile`):

   ```sh
   IMAGE=ghcr.io/wojciechjelen/open-photon-comfy:$(git rev-parse --short HEAD)
   docker build --platform linux/amd64 -f selfhost/Dockerfile -t "$IMAGE" .
   echo "$GHCR_TOKEN" | docker login ghcr.io -u wojciechjelen --password-stdin   # a PAT with write:packages
   docker push "$IMAGE"
   ```

   To build on an x86 GitHub Actions runner instead, run the **Publish Comfy image** workflow (`.github/workflows/publish-comfy.yml`) with `workflow_dispatch`, or push a `comfy-*` tag. It uses the repository's `GITHUB_TOKEN` with `packages: write`, so no PAT is needed. The published image tag is still the repository commit's short SHA; the workflow summary records the image and digest. On the first publish, change the GHCR package's visibility to **Public** in its package settings; linking it to a public repository does not make the package public automatically.

   The image holds no secrets (weights download at boot, the token arrives as `PROXY_TOKEN`), so keep the package public: RunPod then pulls without a registry credential, and GHCR does not rate-limit anonymous pulls of public packages. Building under emulation on an Apple Silicon Docker VM is slow for a ~10 GB image; an x86 GitHub Actions runner (like the CI job that builds the app image) is the practical builder.

2. Create a RunPod secret named `open_photon_proxy_token` (Console → Secrets) holding a long random value, for example from `openssl rand -hex 32`. Keep the value: it is the app's `COMFY_API_KEY`.

3. Create the template from [`selfhost/runpod-template.json`](selfhost/runpod-template.json) (HTTP port 8189 only, `PROXY_TOKEN` from the secret, the volume at `/workspace`) with RunPod's REST API:

   ```sh
   jq --arg image "$IMAGE" '. + {imageName: $image}' selfhost/runpod-template.json |
     curl -fsS https://rest.runpod.io/v1/templates \
       -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' --data @-
   ```

   For a private package, create a RunPod registry credential (GHCR username and a PAT with `read:packages`) and add its `containerRegistryAuthId` to the JSON the same way. Note the returned template `id`.

4. Create a network volume and a pod from the template. The network volume keeps the weights for the next pod; without one, the pod's own volume keeps them until the pod is deleted.

   ```sh
   runpodctl network-volume create --name open-photon-models --size 50 --data-center-id <dc>
   runpodctl pod create --name open-photon-comfy --template-id <template-id> \
     --gpu-id "NVIDIA GeForce RTX 5090" --min-cuda-version 13.0 --data-center-ids <dc> \
     --network-volume-id <volume-id> --volume-mount-path /workspace
   ```

5. Wait for readiness. Follow the log with `runpodctl pod logs <pod-id> --follow`. In order, it shows `Downloading <file>` (first boot only) and `Verified <file>` for every locked file, `Waiting for ComfyUI on 127.0.0.1:8188`, the preflight (one line per runtime workflow, then the summary: `motionTransfer/motion-transfer.v1: 5 model files, 5 locked, 0 missing` and `5 distinct model files across 1 feature lock, 0 conflicts`), and finally:

   ```text
   Serving the Comfy API v2 on 0.0.0.0:8189 (auth: bearer)
   ```

   Then the health route answers (it needs no token):

   ```sh
   curl -fsS https://<pod-id>-8189.proxy.runpod.net/api/v2/health
   ```

   If the container stops instead, the reason is the last log line: [Preflight failures](#preflight-failures-in-the-pod-log).

6. Point the app at the pod, in `.env`:

   ```sh
   COMFY_BASE_URL=https://<pod-id>-8189.proxy.runpod.net
   COMFY_API_KEY=<the open_photon_proxy_token value>
   ```

7. Check the connection from the app's side:

   ```sh
   npm run check:comfy
   # comfy target=selfhost base=https://<pod-id>-8189.proxy.runpod.net auth=bearer
   # OK: reachable and authorized (an unknown job id is 404 not found)
   ```

8. Start the app (`docker compose up --build`). Before it listens it logs `{"auth":"bearer","base":"https://<pod-id>-8189.proxy.runpod.net","event":"comfy.target","target":"selfhost"}`. Mint an access code (`docker compose exec app node scripts/mint-code.mjs me 20`) and generate. Keep `IN_FLIGHT_MAX=1`: ComfyUI runs one job at a time, so a higher cap only queues jobs on the GPU.

9. Stop the pod when you are done (`runpodctl pod stop <pod-id>`). A stopped pod still bills for its volume; `runpodctl pod delete <pod-id>` ends that, and a network volume bills until `runpodctl network-volume delete <volume-id>`.

The first render after a boot also loads the weights from disk into VRAM, so it takes longer than the next ones. The proof row in README ["Open-weights checks and self-hosting"](README.md#open-weights-checks-and-self-hosting) is such a cold render.

### Sizing

| Resource | Value | Basis |
| --- | --- | --- |
| GPU | one x86_64 NVIDIA GPU, at least 32 GB VRAM, CUDA 13 driver (`--min-cuda-version 13.0`) | measured: the 2026-10-21 RTX 5090 proof, 480×848; headroom: [docs/selfhost.md "Known risks"](docs/selfhost.md#known-risks) |
| Container disk | 50 GB | provisional (`containerDiskInGb` in the template) |
| Volume at `/workspace` | 50 GB | provisional: about 26 GB of weights, plus ComfyUI inputs and outputs and the proxy's job records |
| First boot | downloads about 26 GB (five files for `motion-transfer.v1`) from Hugging Face | duration depends on the data center's bandwidth; not measured |
| Every boot | re-hashes every locked file (SHA-256) before ComfyUI starts | minutes on a network volume; not measured precisely |
| First render after boot | adds cold model loading | included in the proof's submission-to-done time |

### Any other GPU host

The same image runs on any x86_64 host with an NVIDIA GPU, a CUDA 13 driver and the NVIDIA Container Toolkit (`docker run --gpus all`). Mount a persistent directory at `/workspace` (or set the paths in [the image's variables](#self-host-image)). Then either:

- publish 8189 only behind TLS (a reverse proxy terminating HTTPS in front of `127.0.0.1:8189`), with `PROXY_TOKEN` set, and set `COMFY_BASE_URL=https://<host>`; or
- keep the proxy on loopback with `PROXY_HOST=127.0.0.1` and no `PROXY_TOKEN`, run the container with `--network host` so the host's loopback is the container's, and reach it through an SSH tunnel (commands: [docs/selfhost.md, "Loopback alternative"](docs/selfhost.md#loopback-alternative-an-ssh-tunnel)).

Plain HTTP on a public port sends the bearer token unencrypted.

## Switching targets

Before switching targets (or self-hosted endpoints) while keeping the same database, stop submitting and wait until no generation is `preparing`, `queued`, `running` or `finalizing`: pending jobs are reconciled through the provider the server uses now, not the target recorded in their recipe, so a job id sent to the other deployment is never found and the row stays in flight (with the default `IN_FLIGHT_MAX=1`, blocking new generations until you switch back and let it finish). Then change `COMFY_BASE_URL` and `COMFY_API_KEY`, run `npm run check:comfy`, and restart the app. Back to Cloud: blank `COMFY_BASE_URL` and set the Cloud key. The server reads the target once, at start.

What it means for results:

- Every recipe records its `target` (`cloud` or `selfhost`), and the recipe hash includes it. Results are never reused across targets: the same choices on the other target render again and spend again. Two self-hosted hosts are one target: [docs/selfhost.md "Known risks"](docs/selfhost.md#known-risks).
- "Re-run recipe" and "Retry" render on the target the server uses now, so re-running another target's generation is a paid job (README ["Recipes and re-runs"](README.md#recipes-and-re-runs)).
- One database holds generations from both targets side by side. To keep the histories apart, give each target its own `DATABASE_PATH` on the same volume, for example `DATABASE_PATH=/app/data/cloud/app.sqlite` and `DATABASE_PATH=/app/data/selfhost/app.sqlite`. Stored files go in `assets/` next to each database; access codes are per database, so mint one in each.

## Environment reference

### App

Set in `.env` (Compose and `npm run check:comfy` read it) or in the process environment.

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMFY_BASE_URL` | unset: Comfy Cloud (`https://cloud.comfy.org`) | Unset, blank or Cloud's URL: Comfy Cloud. Any other http(s) URL without query or fragment: self-hosted, `https://<host>:8189`, a comfy-api-proxy (API v2), never raw ComfyUI on `:8188`. |
| `COMFY_API_KEY` | none | Cloud: required, a Comfy Cloud key. Self-hosted: optional, the proxy's `--token` (`PROXY_TOKEN`). Sent as a bearer; never logged. |
| `PUBLIC_APP_URL` | the request's origin | The deployment's public HTTPS origin; share pages build their absolute Open Graph URLs from it. Set it behind a proxy. |
| `IN_FLIGHT_MAX` | `1` | Generations in flight at once, app-wide; 0 refuses every new one. |
| `CLIENT_IP_HEADER` | unset: the connection's address | The header the proxy in front of the app sets to the client's address (Railway: `X-Real-IP`). Unset, forwarded headers are never trusted. |
| `DATABASE_PATH` | `data/app.sqlite`; `/app/data/app.sqlite` in the image | The SQLite database; stored files go in `assets/` next to it. |
| `UPLOAD_RATE_LIMIT` | `10` | Uploads per minute, per client and per access code. |
| `GENERATE_RATE_LIMIT` | `3` | Generate, retry and re-run requests per minute, per client and per access code. |
| `LOGIN_RATE_LIMIT` | `10` | Wrong access codes per minute, per client. |
| `LOGIN_TOTAL_RATE_LIMIT` | `300` | Wrong access codes per minute across the instance. |
| `ENABLE_DEBUG` | unset | `1` enables `/api/debug/streams` and `/api/debug/heartbeat`. Leave unset outside diagnostics. |

### Self-host image

Set on the GPU container (the RunPod template sets them from [`selfhost/runpod-template.json`](selfhost/runpod-template.json)).

| Variable | Default | RunPod template | Meaning |
| --- | --- | --- | --- |
| `PROXY_TOKEN` | none | the secret `open_photon_proxy_token` | Bearer the proxy requires on `/api/v2/*`; the app's `COMFY_API_KEY`. Required unless `PROXY_HOST=127.0.0.1`. |
| `PROXY_HOST` | `0.0.0.0` | default | Address the proxy binds on port 8189; `127.0.0.1` keeps it local (SSH tunnel). |
| `MODELS_DIR` | `/workspace/models` | `/workspace/models` | Weights in ComfyUI's `models/` layout (`<directory>/<file>`, as the locks name them: `vae/`, `loras/`, …). |
| `COMFYUI_DATA_DIR` | `/workspace/comfyui` | default | ComfyUI's `input/` and `output/`. |
| `PROXY_STATE_DIR` | `/workspace/comfy-api-proxy` | `/workspace/comfy-api-proxy` | The proxy's job, idempotency and asset records. |
| `MAX_UPLOAD_MB` | `128` | `128` | Per-file upload limit of the proxy and of ComfyUI behind it. Keep it at least the app's 128 MiB limit. |

## Troubleshooting

### The app exits at start

The server checks the two variables before it listens and exits with the reason. Without a key and without `COMFY_BASE_URL`:

```text
COMFY_API_KEY is not set. Comfy Cloud (https://cloud.comfy.org, used while COMFY_BASE_URL is unset) requires an API key; set COMFY_BASE_URL to a self-hosted comfy-api-proxy to use a deployment that does not.
```

Fix: set `COMFY_API_KEY`, or point `COMFY_BASE_URL` at your proxy. A malformed URL stops it with `COMFY_BASE_URL is not a URL: "<value>"` or `COMFY_BASE_URL must be an http(s) URL with no query or fragment, such as https://<host>:8189, not "<value>"`. Fix the value.

### `check:comfy` outcomes

The first line always names the target (`comfy target=<cloud|selfhost> base=<url> auth=<bearer|none>`); check it before the second. Every outcome except OK exits 1.

| Second line | Meaning | Fix |
| --- | --- | --- |
| `OK: reachable and authorized (an unknown job id is 404 not found)` | Ready. | None. |
| `FAIL: wrong or missing token: <url> answered 401 (<code>). Set COMFY_API_KEY to a valid Comfy Cloud API key.` (or `403`; `(<code>)` only when the reply carries an error envelope) | Cloud refused the key. | Use a key whose account has workflow-generation access. |
| `FAIL: wrong or missing token: <url> answered 401 (<code>). Set COMFY_API_KEY to the comfy-api-proxy --token.` (or `403`) | The proxy refused the bearer. | Set `COMFY_API_KEY` to the pod's `PROXY_TOKEN` value. |
| `FAIL: this is raw ComfyUI on its native port; run comfy-api-proxy and point COMFY_BASE_URL at it (8189)` | The URL is ComfyUI's own server, which does not serve `/api/v2/*`. | Use port 8189 (on RunPod, `https://<pod-id>-8189.proxy.runpod.net`). |
| `FAIL: no Comfy API v2 at <url>: 404 without an error envelope. Check the URL path and port (a comfy-api-proxy serves /api/v2 at its root).` | Something answered, but not an API v2: wrong port, a path prefix, or a different service. | Use the proxy's root URL on 8189 with no path. |
| `FAIL: unexpected answer from <url>: HTTP <status>` | A reverse proxy or a half-started service answered with another status. | Check what is listening at the URL; on RunPod wait for the pod log's `Serving …` line. |
| `FAIL: unreachable: Could not connect to Comfy (<code>).` | DNS, refused connection, TLS or a stopped pod. | Check the pod is running and its log reached `Serving the Comfy API v2 …`; check the URL and the tunnel. |
| `FAIL: COMFY_API_KEY is not set. …` / `FAIL: COMFY_BASE_URL …` | Invalid config, as at start. | See [The app exits at start](#the-app-exits-at-start). |

### RunPod's proxy cuts streams after 100 s

`*.proxy.runpod.net` closes a connection after 100 seconds without a response. A render takes longer, so the app's job stream from the proxy (`GET /api/v2/jobs/{id}/events`) is cut mid-render. What you observe: the progress on `/g/<id>` pauses or jumps, and the render still reaches `done`. The SDK reads the job with `GET /api/v2/jobs/{id}` when its stream ends and reconnects. The browser's own event stream to the app is unaffected. The alternative transport is in [docs/selfhost.md "Known risks"](docs/selfhost.md#known-risks).

### 413 on uploads

- In the app, "This file is over 128 MiB.": the app's own limit (README ["Upload size limit"](README.md#upload-size-limit)). Use a smaller file.
- A generation fails while preparing with `Comfy refused the request (…)` after a large upload on self-host: the proxy's or ComfyUI's per-file limit is below the file. Set `MAX_UPLOAD_MB` on the GPU container to at least `128` and restart it. Nothing was rendered, and the access code's count is given back.

### Preflight failures in the pod log

The container stops before it serves 8189, with one of these as the last lines:

| Log line | Cause | Fix |
| --- | --- | --- |
| `PROXY_TOKEN is required when the proxy listens on 0.0.0.0. …` | No secret reached the container. | Create the `open_photon_proxy_token` secret, or set `PROXY_HOST=127.0.0.1` for a tunnel. |
| `Missing or mismatched model: <path>` / `SHA-256 mismatch: <file>` | A file on the volume, or a download, does not match its lock's hash. The installer never replaces an existing file. | Delete that file from the volume and restart: the next boot downloads it again. |
| `Model download failed: HTTP <status>` | Hugging Face refused or failed the download. | Restart the container; files already verified are kept. |
| `Conflicting pins for <directory>/<file>: <featureA> and <featureB>` | Two features pin the same `directory/file` with a different hash or URL. The installer fails before any download; `npm run check:models` (and CI) fails on the same line. | Make the two features' `models.lock` entries identical, or give the different file its own name in its feature's lock and workflow. |
| `<feature>/<workflow>: ComfyUI is missing node definitions: <classes>` | This ComfyUI lacks a node class the workflow uses. | Build the image at a ComfyUI commit that has it (`COMFYUI_COMMIT` in `selfhost/Dockerfile`). A paid partner node is not a workaround. |
| `<feature>/<workflow>: ComfyUI does not list <file> for <class_type>.<field>; is it under <MODELS_DIR>/<directory>?` | ComfyUI did not offer the locked file to the loader node that needs it. | Check `MODELS_DIR` and the volume mount; the file must be at `<MODELS_DIR>/<directory>/<file>`, the directory being the loader's (`vae/`, `loras/`, …). |
| `ComfyUI exited (<status>) before it served /object_info.` | ComfyUI crashed at start (driver, CUDA, out of memory). | Read ComfyUI's output above it; check the host has a CUDA 13 driver. |
| `ComfyUI exited (<status>); stopping.` / `comfy-api-proxy exited (<status>); stopping.` | One of the two processes died after start; the container stops so the pod restarts it. | Read the output above it; for the proxy, check `PROXY_TOKEN`/`PROXY_HOST` and the state directory's permissions. |
| `Missing models.lock for <feature>/<id>.v<N>: the graph loads <n> model file(s)` | A runtime workflow names weights but has no `models.lock` beside it. | Add the lock (see `.claude/skills/add-new-feature/SKILL.md`, "Models"). |

## Where things live

- [docs/selfhost.md](docs/selfhost.md): the GPU image's behavior, known risks, the proof run and how to record another, manual setup on any GPU box (including the SSH tunnel).
- [DEPLOYMENT-QA-TEST.md](DEPLOYMENT-QA-TEST.md): the step-by-step test plan for this deployment config on both targets.
- [.claude/skills/add-new-feature/SKILL.md](.claude/skills/add-new-feature/SKILL.md): adding a feature that runs on both targets, including a new model.
- `src/features/<feature>/workflows/models.lock`: each feature's model pins, beside its runtime workflows (`<id>.v<N>.json` with `<id>.v<N>.inputs.json`). Motion Transfer's: [src/features/motionTransfer/workflows/models.lock](src/features/motionTransfer/workflows/models.lock).
- [README.md](README.md): what the app does, its API, access codes, limits, verification and CI.
