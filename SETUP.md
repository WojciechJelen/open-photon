# Deploy Open Photon with your agent

You are helping the user install Open Photon on their own accounts. Carry this deployment
through to a verified working installation. Explain each human-only step, resume after it, and
keep a short record of completed steps so an interrupted run does not create duplicate services.

Repository: https://github.com/WojciechJelen/open-photon
Supported image release: **0.4.1**. Both images include Sprite Forge and come from the same source commit.

Read the public release manifest before provisioning:
https://github.com/WojciechJelen/open-photon/releases/download/v0.4.1/image-pair.json

The manifest has `version`, `sourceCommit`, `anonymousPullVerified` and an `images` array.
Require version `0.4.1`, anonymous pull verification, and exactly these repositories:

- App: `ghcr.io/wojciechjelen/open-photon:0.4.1`, Linux AMD64 and ARM64.
- GPU: `ghcr.io/wojciechjelen/open-photon-comfy:0.4.1`, Linux AMD64.

Each image's `digest` must be `sha256:` followed by 64 hexadecimal characters, and every
platform's `revision` must equal `sourceCommit`. Resolve the app and GPU references from that
manifest to `ghcr.io/wojciechjelen/<repository>@<digest>`. Record these as `APP_IMAGE` and
`GPU_IMAGE` in the local deployment record and use the immutable references for every create.
Stop if the manifest is unavailable or inconsistent; do not substitute `latest` or an older tag.

Both images are public. An end user needs no GitHub account, GHCR token, repository fork,
source build, Node installation or local Python environment. Docker or the selected host's
container tooling is enough. If source files are needed for diagnostics, read the manifest's
exact `sourceCommit` rather than mixing the images with a moving `main` checkout.

## 1. Discover what the user already has

Inspect available tools, provider logins and existing Open Photon resources before asking for
information. Reuse an existing working installation when that is the user's intent. Preserve
unrelated services, databases, volumes and credentials. Do not change a working deployment's
backend while it has jobs in flight.

Ask only for missing choices the agent cannot discover:

- Where should the app run? Use the user's preferred compatible container host. Railway is a
  tested example; a Docker server also works. Do not silently create a new paid account.
- Should the installation include Sprite Forge sheets? Recommend the complete Runpod path
  below. Comfy Cloud is an alternative when the user accepts the feature limitation in section 3.
- What spending limit covers provisioning, the first model installation and a real smoke render?
  What should happen to the GPU when unused: stay running, or stop manually after each session?

Before creating billable resources, fetch current provider prices, explain compute and storage
charges, and obtain a spending limit that covers the cold start and test. Track elapsed costs
against that limit. If the limit becomes insufficient, save progress and stop the GPU before
asking for more budget. Stopping retains billable storage; deleting a pod destroys its volume
disk. Never delete user data to meet a budget without explicit agreement.

Keep a private local deployment record containing the chosen image digests, non-secret resource
IDs, URLs, approved budget, completed checks and next step. Inspect recorded resources before
retrying a create. Keep credentials in separate protected files or provider secret stores,
with owner-only permissions on local files. Never paste tokens into chat, commit them, bake
them into images, print complete environment dumps, or put them in public reports.

## 2. Check the app host

The app host must support:

- A continuously running Linux container, one app instance/process, with port 3000 exposed.
  This installation uses SQLite and an in-process dispatcher; do not enable horizontal scaling
  or use a static-site/short-lived-function deployment.
- A writable persistent volume mounted at `/app/data`, preserving the database and sibling
  `assets/` directory through container replacements. A disposable container filesystem is not enough.
- A public HTTPS origin for a remote installation, streaming Server-Sent Events and uploads up
  to 128 MiB. Configure the reverse proxy to stream without buffering progress responses.
- Outbound HTTPS access to the selected rendering backend. One CPU and 1 GB RAM were used in
  the Railway proof; the GPU is a separate service.

Use the host's native environment-variable, persistent-volume, domain and container-exec
facilities. Adapt commands to the tools actually installed. Check CLI help instead of copying
obsolete flags. Local Docker is a useful reference, not a requirement to deploy on Railway or
another compatible container platform.

## 3. Set up the rendering backend

### Complete installation: Runpod

Runpod is the supported and tested self-hosted GPU path. Custom nodes are packaged in our GPU
image; a generic Runpod ComfyUI template or a bare ComfyUI server does not provide this API.
The app speaks Comfy API v2 through our proxy on **8189**, not native ComfyUI on 8188.

Guide the user through Runpod account login and funding if needed. Use an existing connected
Runpod tool or CLI when available; do not require a particular agent plugin. A deployment API
key is used by deployment tooling only and must not be passed to the app container.

The user must also sign into Hugging Face and accept the model licence themselves at:
https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy
Obtain a read token authorized for that gated repository through a local secret file or the
provider's secret store. Licence acceptance is required by the image's complete model installer,
even if the first workflow tested is Sprite Forge.

Generate a new strong random proxy secret locally; do not ask the user to invent one. Supply
these secrets only to the GPU container:

| Variable | Value |
| --- | --- |
| `HF_TOKEN` | The Hugging Face read token with access to the gated model repository |
| `PROXY_TOKEN` | The generated proxy secret; the app must receive the same value under `COMFY_PROXY_TOKEN` |

Create or reuse a Secure Cloud GPU pod with:

| Setting | Required configuration |
| --- | --- |
| Image | The resolved `GPU_IMAGE`, including the Sprite Forge node pack |
| GPU | One NVIDIA A40 48 GB is the tested profile; use a GPU with at least 48 GB VRAM |
| Driver | CUDA 13-compatible; set the scheduler's minimum CUDA version to 13.0 |
| Container disk | 50 GB |
| Persistent model/data disk | 170 GB mounted at `/workspace` |
| Public HTTP port | `8189/http` |
| Authentication | Set `PROXY_TOKEN`; expose the authenticated proxy, not native ComfyUI |

Select a region with current GPU availability. Confirm the price and configuration before
creation. A larger GPU or a different storage arrangement requires fitting the approved budget.
Runpod pod volume disks persist across stops, but are deleted with the pod. Network volumes
persist independently and keep billing until separately deleted. Use a network volume only
when the user needs model storage to outlive/reuse multiple pods and approves that cost.

The first boot installs and verifies **21 model files, about 136.1 GB**. The measured cold boot,
including image pull, took about **37 minutes**. Expect a long first installation; a running
pod is not yet a ready backend. Follow logs and retain the same volume rather than repeatedly
recreating the pod. Do not submit paid renders before all of these appear:

```text
21 distinct "Verified <model file>" lines
Import times for custom nodes includes /opt/ComfyUI/custom_nodes/sprite_forge
spriteForge/sprite-view.v1: 5 model files, 5 locked, 0 missing
spriteForge/sprite-sheet.v1: 7 model files, 7 locked, 0 missing
Serving the Comfy API v2 on 0.0.0.0:8189 (auth: bearer)
```

Record the backend URL `https://<pod-id>-8189.proxy.runpod.net`. Verify it from outside the pod
with the bearer token: a GET to `/api/v2/jobs/<fresh-random-UUID>` must return HTTP 404 with a
JSON error envelope whose `error.code` is `not_found` or `job_not_found`. A generic HTML 404 is
not success. HTTP 401/403 means authentication failed. Do not expose the token in logs or URLs.

### Alternative: Comfy Cloud

Use this branch only when the user chooses it. Guide them to https://cloud.comfy.org to create
an API key and obtain credits. Supply `COMFY_API_KEY` to the app; leave `COMFY_BASE_URL` and
`COMFY_PROXY_TOKEN` unset. No Runpod pod, Hugging Face token or GPU volume is needed.

Cloud draws Sprite Forge's five direction views but **cannot forge full sprite sheets**. Its
sheet button is disabled and the API answers `selfhost_required`. Do not present this branch
as a complete replacement for the Runpod installation.

## 4. Deploy the app container

Pull the resolved `APP_IMAGE`. Create or reuse its own persistent `/app/data` volume. Keep app
runtime settings separate from GPU and deployment credentials:

| App variable | Runpod | Comfy Cloud |
| --- | --- | --- |
| `COMFY_BASE_URL` | The pod's HTTPS proxy origin, without `/api/v2`, query or credentials | Unset |
| `COMFY_PROXY_TOKEN` | The exact GPU `PROXY_TOKEN` secret | Unset |
| `COMFY_API_KEY` | **Unset** | The user's Cloud API key |
| `PUBLIC_APP_URL` | The installation's actual public HTTPS origin | Same |
| `DATABASE_PATH` | `/app/data/app.sqlite` | Same |
| `IN_FLIGHT_MAX` | `1` | `1` unless the user's Cloud concurrency supports more |
| `PORT` | `3000`, or the listening port required by the host | Same |

The image already sets `HOST=0.0.0.0`, `PORT=3000` and the database path. A Cloud key combined
with a self-host proxy URL deliberately prevents startup. Do not put `HF_TOKEN`,
`RUNPOD_API_KEY`, registry credentials or app-host deployment credentials in the app environment.
Leave optional rate limits and polling settings at their defaults unless the deployment needs
an explicit change. Set `CLIENT_IP_HEADER` only to a header a trusted ingress overwrites; do
not trust arbitrary client-supplied forwarded addresses.

For a local Docker reference, set `APP_IMAGE` to the resolved immutable reference, write only the selected app runtime variables to a protected
`app.env` file, then run:

```sh
docker volume create open-photon-data
docker run -d --name open-photon --init --restart unless-stopped \
  --env-file app.env -p 127.0.0.1:3030:3000 \
  --mount type=volume,src=open-photon-data,dst=/app/data \
  "$APP_IMAGE"
```

Run this only on the host the user selected, after checking whether the named container/volume
already exists. For a remote Docker host, configure HTTPS ingress to the app. For a local
browser installation use http://localhost:3030 and test login; public hosting needs HTTPS.
If a mounted directory is root-owned, fix ownership for UID/GID 1000, or start the image's
entrypoint as root so it fixes the data-directory ownership and drops to the `node` user.
The application process must run unprivileged.

Check `/healthz` returns HTTP 200 with `ok`, and inspect the non-secret startup event
`comfy.target` for the intended backend. App health alone does not check backend connectivity.
Confirm the volume mount and actual database location before creating the first access code.

After the app has initialized its database, run inside its running container:

```sh
node scripts/mint-code.mjs owner 20
```

For Docker this is `docker exec open-photon node scripts/mint-code.mjs owner 20`. Use the
selected platform's exec facility otherwise. The number is a generation allowance, not a
monetary limit. Keep the printed code private and give it to the user through an appropriate
private channel. Sign in at `/access` with that code. A fresh installation has no admin dashboard
or automatic public-result generation; do not mistake an empty Explore page for failed setup.

## 5. Verify a real working installation

Use the browser on the new app domain. Confirm login and a normal page load. For the complete
Runpod path, select Kenji in Sprite Forge, draw five directions and wait for all five to be
Done. Keep the default facing unless a turned view clearly faces right. Forge one **Quick**
sheet, within the agreed smoke-test budget. This exercises the actual custom node pack.

Verify through the UI and API:

- `/api/sprite-sets/<set-id>` says `sheets_available: true`; all five views and the sheet are done.
- Each `/api/generations/<id>/recipe.json` says `target: "selfhost"` and records the expected
  workflow hash and model pins from the image's source commit.
- The sheet has `hd`, `pixel`, `hd-json` and `pixel-json` outputs. PNGs are RGBA, HD 1024x1280
  and pixel 384x480. Both JSON outputs parse with 64 frames, eight tags in order `walk_s`,
  `walk_sw`, `walk_w`, `walk_nw`, `walk_n`, `walk_ne`, `walk_e`, `walk_se`, and eight
  `meta.loops` entries. The pixel JSON has 24 `meta.palette` entries; the outline can add a
  twenty-fifth opaque RGB colour to the PNG.
- The playground loads. A moves left facing left, D moves right facing right, W shows the back
  and S the front. The back row stays back-facing. Inspect the other four directions too.
- No CUDA out-of-memory error or Python traceback appears in the pod log.

Save non-secret generation IDs, timings, recipe checks and test results. Do not claim a render
worked from HTTP 200, a queued job or a healthy container alone. If the budget cannot cover the
real smoke render, report exactly which checks remain unverified rather than claiming success.
For a Cloud installation, use a supported image/video generation and record target `cloud`.

Generated loop quality varies. The measured Best of 3 sheet did not beat an independently
seeded Quick sheet in every direction; a working deployment does not guarantee a smooth walk
for every seed. Do not spend additional money rerolling to conceal a failed quality check.

## 6. Hand over and keep it usable

Deliver the app URL, image release/digests, backend choice, non-secret resource IDs, completed
checks, actual/estimated costs and the agreed idle-GPU plan. Keep the installation available
for the user. Apply the agreed stop policy; delete temporary test resources only when agreed.

Explain these operations using the user's actual resource IDs and provider tooling:

- **Stop and restart the GPU.** Stopping ends GPU compute charges but retains billable disk.
  Model files and proxy job records belong on `/workspace`. A stopped pod may not find an
  available GPU on its original machine when restarted. Read the provider's current behavior,
  check readiness and the proxy URL after restart, and update the app if the origin changed.
- **Back up app data.** Preserve the SQLite database and the entire sibling `assets/` directory
  together. Quiesce jobs and stop the app before a filesystem copy, or use a consistent SQLite
  backup mechanism. Keep a copy outside the volume and test that it can be restored.
- **Upgrade.** Back up first, settle in-flight jobs, choose a compatible app/GPU release pair,
  preserve both volumes and verify again. Do not run the old and new app replicas simultaneously
  against the same database. Keep the old image digests and a matching database backup for rollback.
- **Remove the installation.** Confirm what data to retain before deleting app or GPU storage.
  Independently created network volumes continue billing after pod deletion.

## Troubleshooting

| Symptom | Check and recovery |
| --- | --- |
| GPU boot stops at gated model access | Have the user accept the licence on the same Hugging Face account as the token; check read access, then resume on the existing volume. |
| `provider_rejected` names a Sprite node | Verify the GPU image digest and the node-pack preflight; older images and generic ComfyUI images lack the pack. |
| `selfhost_required` or `sheets_available: false` | Check the selected backend, remove a leftover Cloud key from a Runpod app and restart the app with the corrected environment. |
| `provider_unreachable` | Check that the pod is running and ready, the proxy URL/8189 port is correct and the app can reach it. |
| Proxy HTTP 401/403 | Check that the app's proxy token exactly matches the pod's secret; never bypass authentication. |
| App refuses startup | Inspect the error, backend-variable combination and volume permissions; do not repeatedly recreate resources. |
| Access code does not work | Confirm it was minted inside this app's actual database after initialization; mint a new code if lost. |
| CUDA out of memory | Stop new submissions, record GPU/model details and the failure, then obtain approval for any larger-GPU cost. |

Primary references, to verify current provider details:

- https://docs.runpod.io/pods/configuration/expose-ports
- https://docs.runpod.io/pods/storage/types
- https://docs.runpod.io/pods/pricing
- https://docs.docker.com/engine/storage/volumes/
