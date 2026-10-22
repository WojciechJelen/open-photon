# Deployment reference

For the short image-only instructions, see [SETUP.md](../SETUP.md).

## Development from source

Use Node 24+, npm 11.6.2 and FFmpeg. Copy `.env.example` to `.env`, choose one backend,
then run `npm ci` and `npm run dev`. To build the app image yourself:

```sh
docker build -t open-photon:local .
```

## Sizing

The app image supports Linux AMD64 and ARM64. The GPU image requires an AMD64 NVIDIA
host with a CUDA 13-compatible driver, at least 32 GB VRAM, and the NVIDIA Container
Toolkit. The recorded 32 GB proof is close to capacity; 48 GB leaves more headroom.
Allow 50 GB container disk and 50 GB persistent storage at `/workspace`. The first
GPU boot downloads roughly 26 GB of models; every boot verifies their hashes.

## Publishing images

Run the GitHub Actions **CI** workflow with `publish=true` and `version` matching
`package.json`. After verification, native AMD64 and ARM64 runners build the app;
an AMD64 runner builds the GPU image. Only when all builds succeed are both version
tags published to GHCR. Set each package's visibility to **Public** on its first
publication so users and Runpod can pull without registry credentials.

Keep the app image in `compose.yaml`, the GPU image in `selfhost/runpod-template.json`,
and the examples in `SETUP.md` on the same release. Publish a new version when workflows,
model pins or GPU dependencies change. The Runpod template uses the REST v2 shape:
`POST https://api.runpod.io/v2/templates` with that JSON body. It contains no secrets;
each operator supplies their own `PROXY_TOKEN` at deployment.

## Switching backends

Finish all in-flight generations before changing backend or proxy URL. Pending jobs
belong to the original deployment. Restart the app with the new environment; completed
results remain on its data volume. For isolated histories, use separate app volumes.
Cloud and self-hosted recipes have distinct hashes; self-hosted instances with the same
workflow and weights intentionally share recipe identity.

## Environment reference

### App

Set in `.env` (Compose and `npm run check:comfy` read it) or in the process environment.

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMFY_BASE_URL` | unset: Comfy Cloud (`https://cloud.comfy.org`) | With a Cloud key, unset, blank or Cloud's URL selects Cloud. Without a Cloud key, any other http(s) URL without query or fragment: self-hosted, `https://<host>:8189`, a comfy-api-proxy (API v2), never raw ComfyUI on `:8188`. |
| `COMFY_API_KEY` | none | Comfy Cloud key. Must be unset when using a self-hosted proxy. |
| `COMFY_PROXY_TOKEN` | none | Self-hosted proxy bearer token (`PROXY_TOKEN` on the GPU container). Requires a proxy URL and must be unset for Cloud. |
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

Set on the GPU container (the RunPod template sets them from [`selfhost/runpod-template.json`](../selfhost/runpod-template.json)).

| Variable | Default | RunPod template | Meaning |
| --- | --- | --- | --- |
| `PROXY_TOKEN` | none | supplied by the operator | Bearer the proxy requires on `/api/v2/*`; the app's `COMFY_PROXY_TOKEN`. Required unless `PROXY_HOST=127.0.0.1`. |
| `PROXY_HOST` | `0.0.0.0` | default | Address the proxy binds on port 8189; `127.0.0.1` keeps it local (SSH tunnel). |
| `MODELS_DIR` | `/workspace/models` | `/workspace/models` | Weights in ComfyUI's `models/` layout (`<directory>/<file>`, as the locks name them: `vae/`, `loras/`, …). |
| `COMFYUI_DATA_DIR` | `/workspace/comfyui` | default | ComfyUI's `input/` and `output/`. |
| `PROXY_STATE_DIR` | `/workspace/comfy-api-proxy` | `/workspace/comfy-api-proxy` | The proxy's job, idempotency and asset records. |
| `MAX_UPLOAD_MB` | `128` | `128` | Per-file upload limit of the proxy and of ComfyUI behind it. Keep it at least the app's 128 MiB limit. |

## Troubleshooting

### The app exits at start

The server checks the backend variables before it listens and exits with the reason. Without a key and without `COMFY_BASE_URL`:

```text
Set COMFY_API_KEY for Comfy Cloud, or COMFY_BASE_URL and COMFY_PROXY_TOKEN for a self-hosted comfy-api-proxy.
```

Choose one backend. Unset the Cloud key when using a proxy; unset the proxy token
when using Cloud. URL errors name `COMFY_BASE_URL` without printing its value.
The URL must be HTTP(S), with no embedded credentials, query or fragment.

### `check:comfy` outcomes

From a source checkout, run `npm run check:comfy`. It makes a read-only request; it
does not submit a generation.

The first line always names the target (`comfy target=<cloud|selfhost> base=<url> auth=<bearer|none>`); check it before the second. Every outcome except OK exits 1.

| Second line | Meaning | Fix |
| --- | --- | --- |
| `OK: reachable and authorized (an unknown job id is 404 not found)` | Ready. | None. |
| `FAIL: wrong or missing token: <url> answered 401 (<code>). Set COMFY_API_KEY to a valid Comfy Cloud API key.` (or `403`; `(<code>)` only when the reply carries an error envelope) | Cloud refused the key. | Use a key whose account has workflow-generation access. |
| `FAIL: wrong or missing token: <url> answered 401 (<code>). Set COMFY_PROXY_TOKEN to the comfy-api-proxy --token.` (or `403`) | The proxy refused the bearer. | Set `COMFY_PROXY_TOKEN` to the pod's `PROXY_TOKEN` value. |
| `FAIL: this is raw ComfyUI on its native port; run comfy-api-proxy and point COMFY_BASE_URL at it (8189)` | The URL is ComfyUI's own server, which does not serve `/api/v2/*`. | Use port 8189 (on RunPod, `https://<pod-id>-8189.proxy.runpod.net`). |
| `FAIL: no Comfy API v2 at <url>: 404 without an error envelope. Check the URL path and port (a comfy-api-proxy serves /api/v2 at its root).` | Something answered, but not an API v2: wrong port, a path prefix, or a different service. | Use the proxy's root URL on 8189 with no path. |
| `FAIL: unexpected answer from <url>: HTTP <status>` | A reverse proxy or a half-started service answered with another status. | Check what is listening at the URL; on RunPod wait for the pod log's `Serving …` line. |
| `FAIL: unreachable: Could not connect to Comfy (<code>).` | DNS, refused connection, TLS or a stopped pod. | Check the pod is running and its log reached `Serving the Comfy API v2 …`; check the URL and the tunnel. |
| `FAIL: Set COMFY_API_KEY …` / `FAIL: COMFY_BASE_URL …` | Invalid config, as at start. | See [The app exits at start](#the-app-exits-at-start). |

### RunPod's proxy cuts streams after 100 s

`*.proxy.runpod.net` closes a connection after 100 seconds without a response. A render takes longer, so the app's job stream from the proxy (`GET /api/v2/jobs/{id}/events`) is cut mid-render. What you observe: the progress on `/g/<id>` pauses or jumps, and the render still reaches `done`. The SDK reads the job with `GET /api/v2/jobs/{id}` when its stream ends and reconnects. The browser's own event stream to the app is unaffected. The alternative transport is in [docs/selfhost.md "Known risks"](selfhost.md#known-risks).

### 413 on uploads

- In the app, "This file is over 128 MiB.": the app's own limit (README ["Upload size limit"](../README.md#upload-size-limit)). Use a smaller file.
- A generation fails while preparing with `Comfy refused the request (…)` after a large upload on self-host: the proxy's or ComfyUI's per-file limit is below the file. Set `MAX_UPLOAD_MB` on the GPU container to at least `128` and restart it. Nothing was rendered, and the access code's count is given back.

### Preflight failures in the pod log

The container stops before it serves 8189, with one of these as the last lines:

| Log line | Cause | Fix |
| --- | --- | --- |
| `PROXY_TOKEN is required when the proxy listens on 0.0.0.0. …` | No secret reached the container. | Set `PROXY_TOKEN` on the pod, or set `PROXY_HOST=127.0.0.1` for a tunnel. |
| `Missing or mismatched model: <path>` / `SHA-256 mismatch: <file>` | A file on the volume, or a download, does not match its lock's hash. The installer never replaces an existing file. | Delete that file from the volume and restart: the next boot downloads it again. |
| `Model download failed: HTTP <status>` | Hugging Face refused or failed the download. | Restart the container; files already verified are kept. |
| `Conflicting pins for <directory>/<file>: <featureA> and <featureB>` | Two features pin the same `directory/file` with a different hash or URL. The installer fails before any download; `npm run check:models` (and CI) fails on the same line. | Make the two features' `models.lock` entries identical, or give the different file its own name in its feature's lock and workflow. |
| `<feature>/<workflow>: ComfyUI is missing node definitions: <classes>` | This ComfyUI lacks a node class the workflow uses. | Build the image at a ComfyUI commit that has it (`COMFYUI_COMMIT` in `selfhost/Dockerfile`). A paid partner node is not a workaround. |
| `<feature>/<workflow>: ComfyUI does not list <file> for <class_type>.<field>; is it under <MODELS_DIR>/<directory>?` | ComfyUI did not offer the locked file to the loader node that needs it. | Check `MODELS_DIR` and the volume mount; the file must be at `<MODELS_DIR>/<directory>/<file>`, the directory being the loader's (`vae/`, `loras/`, …). |
| `ComfyUI exited (<status>) before it served /object_info.` | ComfyUI crashed at start (driver, CUDA, out of memory). | Read ComfyUI's output above it; check the host has a CUDA 13 driver. |
| `ComfyUI exited (<status>); stopping.` / `comfy-api-proxy exited (<status>); stopping.` | One of the two processes died after start; the container stops so the pod restarts it. | Read the output above it; for the proxy, check `PROXY_TOKEN`/`PROXY_HOST` and the state directory's permissions. |
| `Missing models.lock for <feature>/<id>.v<N>: the graph loads <n> model file(s)` | A runtime workflow names weights but has no `models.lock` beside it. | Add the lock (see `.claude/skills/add-new-feature/SKILL.md`, "Models"). |

## Where things live

- [docs/selfhost.md](selfhost.md): the GPU image's behavior, known risks, the proof run and how to record another, manual setup on any GPU box (including the SSH tunnel).
- [DEPLOYMENT-QA-TEST.md](../DEPLOYMENT-QA-TEST.md): the step-by-step test plan for this deployment config on both targets.
- [.claude/skills/add-new-feature/SKILL.md](../.claude/skills/add-new-feature/SKILL.md): adding a feature that runs on both targets, including a new model.
- `src/features/<feature>/workflows/models.lock`: each feature's model pins, beside its runtime workflows (`<id>.v<N>.json` with `<id>.v<N>.inputs.json`). Motion Transfer's: [src/features/motionTransfer/workflows/models.lock](../src/features/motionTransfer/workflows/models.lock).
- [README.md](../README.md): what the app does, its API, access codes, limits, verification and CI.
