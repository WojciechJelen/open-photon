# Self-hosting on your own GPU

Reference for the GPU side of a self-hosted Open Photon: the [`selfhost/`](../selfhost/) image, its known risks, how to verify a render, and the manual setup it automates.

## Deploy

Deploying it (RunPod walkthrough, any other GPU host), the app's variables, sizing and troubleshooting: [SETUP.md](../SETUP.md).

## Image settings

The image's variables, defaults and RunPod template values: [SETUP.md, "Self-host image"](../SETUP.md#self-host-image).

At start, `selfhost/entrypoint.sh` runs, in order:

1. `node scripts/install-models.mjs "$MODELS_DIR"`: installs the aggregate of every feature's `models.lock` (two features pinning the same `directory/file` differently fail before any download), downloads what is missing and hash-verifies every file, every boot.
2. ComfyUI on `127.0.0.1:8188` with `--models-directory "$MODELS_DIR"`, `--input-directory` and `--output-directory` under `$COMFYUI_DATA_DIR`, and `--max-upload-size $((MAX_UPLOAD_MB + 1))` (ComfyUI's default is 100 MiB).
3. Once ComfyUI serves `/object_info`: `node scripts/check-models-lock.mjs --definitions <object_info>`, which checks every runtime workflow's node classes and that every locked file is among ComfyUI's loader choices.
4. `comfy-api-proxy run` on `$PROXY_HOST:8189` with `--comfyui http://127.0.0.1:8188`, `--comfyui-base-dir` (it only gates model-file uploads; outputs come through ComfyUI's `/view`), `--max-upload-mb "$MAX_UPLOAD_MB"`, `--state-dir "$PROXY_STATE_DIR"`, and `--token "$PROXY_TOKEN"` when that is set.

ComfyUI listens on loopback port 8188 only; port 8189 is the only one the template exposes. The proxy serves at most 8 event streams at once. The container stops when ComfyUI or the proxy stops, and passes a stop signal to both.

## Known risks

- **RunPod's HTTP proxy closes slow connections** ([RunPod's port documentation](https://docs.runpod.io/pods/configuration/expose-ports)); what that does to a render: [SETUP.md, Troubleshooting](../SETUP.md#runpods-proxy-cuts-streams-after-100-s). The alternative is to expose 8189 as a TCP port on a pod with a public IP (`http://<ip>:<external port>`); that connection is plain HTTP, so the bearer token travels unencrypted.
- **Self-hosted recipes dedupe across hosts.** A recipe's hash includes its `target` (`selfhost`) but not the host, so two self-hosted pods with the same pinned weights reuse each other's results. That is intended: the workflow and the weights are pinned, so the recipe is the same.
- **32 GB is close to the measured peak** (the proof row in [README](../README.md#open-weights-checks-and-self-hosting)). A smaller GPU, or a larger resolution than 480×848, may run out of VRAM.

## Verify

Proof run: [selfhost-proof-2026-10-21](selfhost-proof-2026-10-21/README.md) (its numbers are the README proof row). To record and verify another render the same way:

### Record and verify one render

On the pod, start recording before clicking Generate:

```sh
mkdir -p work
TZ=UTC nvidia-smi --query-gpu=timestamp,name,memory.used \
  --format=csv,noheader,nounits -l 1 | tee work/vram.csv
```

In the app, pick a 3–8 second motion with audible sound and a sample character, then Generate. Keep the recording running until the app reaches `done`. Play the compare view, confirm the character moves, and listen for the driving clip's audio once. Copy the generation ID from `/g/<id>`. Stop the GPU recording and copy `work/vram.csv` from the pod to the local repository's `work/vram.csv`.

Verify locally with the access code minted on the app's database, set in the environment:

```sh
BASE_URL=http://localhost:3030 VRAM_CSV=work/vram.csv \
  node scripts/verify-selfhost.mjs <generation-id>
```

`ACCESS_CODE` must also be set. The script checks the stored `done` generation, `target: selfhost`, workflow hash and all five model pins; downloads and decodes the H.264 output with audio; and writes `work/selfhost-<id>.json` with elapsed seconds and peak MiB measured during this generation. It rejects a recording that does not span the render. Playback and matching the source audio still require observation.

Fill the README row from that report and record the playback observation in CHECKLIST.md. Keep the GPU CSV, recipe JSON and output as evidence. If the workflow runs out of VRAM, retain the error and record the limit before trying a separately pinned variant.

After recording the evidence, stop the paid pod in Runpod.

## Appendix: manual setup on any GPU box

The image automates these steps; they are how the 2026-10-21 proof was set up by hand on Runpod's ComfyUI template.

### Pod requirements

- One NVIDIA GPU sized as in [SETUP.md, "Sizing"](../SETUP.md#sizing), with no other workload running. The proof used one GeForce RTX 5090 on official template `wgd3p4n4o6`, image `runpod/comfyui:1.3.3-comfyuiv0.30.0-cuda13.0`, with a 150 GB container disk and 100 GB persistent volume. Its bundled ComfyUI 0.30.0 lacks the required Wan Animate 2 and loop nodes; update it before generating. ComfyUI core must include `WanAnimate2ToVideo`, `WanAnimate2Cache`, and the loop nodes in the workflow. The preflight below checks all required node classes.
- At least 80 GB persistent disk for ComfyUI, its environment, approximately 26 GB of weights and outputs. Use 100 GB if the fused distilled or non-LoRA base variants will also be measured.
- Node 24+ for the repository scripts and Python 3.10+ for `comfy-api-proxy`.

### Install the exact model files

On the GPU host, clone this repository and enter its directory. Set `COMFYUI_DIRECTORY` to the actual ComfyUI directory, for example `/workspace/runpod-slim/ComfyUI` on the Runpod template.

```sh
export COMFYUI_DIRECTORY=/workspace/runpod-slim/ComfyUI
npm install -g npm@11.6.2
npm ci --omit=dev
node scripts/check-models-lock.mjs                                          # every runtime workflow against its feature's lock
node scripts/install-models.mjs "$COMFYUI_DIRECTORY/models"                 # every feature's lock
node scripts/install-models.mjs "$COMFYUI_DIRECTORY/models" --verify-only
```

The installer streams each download, verifies SHA-256 before renaming it into place, and skips files whose hashes already match. A mismatched existing file stops the script so a template's weights are not silently replaced. Downloads use the immutable Hugging Face revision URLs from each feature's `src/features/<feature>/workflows/models.lock` (Motion Transfer: [src/features/motionTransfer/workflows/models.lock](../src/features/motionTransfer/workflows/models.lock)).

The first proof uses the **unchanged** v1 workflow: `wan_animate_2_int8_convrot.safetensors` plus the lightx2v distillation LoRA, six steps, 480×848 for a portrait clip. The fused `wan_animate_2_distill_int8_convrot.safetensors` is a different model file and is not substituted under the base model's filename. Any later variant needs its own workflow hash and lock entry before it can be reported as reproducible.

### Check ComfyUI and start the v2 proxy

The proof used ComfyUI 0.42.0 at commit `7a28332047b6af638dc6c7f72ef3481a718769fd`, PyTorch `2.10.0+cu130`, Python 3.12.3 and NVIDIA driver 595.91.07. With the official template above, update its core and install dependencies into its existing virtual environment:

```sh
cd "$COMFYUI_DIRECTORY"
git fetch --depth 1 https://github.com/Comfy-Org/ComfyUI.git \
  7a28332047b6af638dc6c7f72ef3481a718769fd
git checkout --detach 7a28332047b6af638dc6c7f72ef3481a718769fd
.venv-cu128/bin/python -m pip install -r requirements.txt
```

Stop the template's existing `main.py` process before starting the updated core with `.venv-cu128/bin/python main.py --listen 127.0.0.1 --port 8188`. The template keeps SSH alive when ComfyUI exits. Install Node 24 outside `/workspace` (for example `/opt/open-photon-node`); this template's persistent filesystem rejects archive ownership changes, so extract it with `tar --no-same-owner`.

Start ComfyUI on loopback port 8188. The proxy refuses to bind `0.0.0.0` without a token, so in the shell that will run it set `export PROXY_TOKEN="$(openssl rand -hex 32)"` first and keep the value for the app's `COMFY_API_KEY` (never paste it into logs or evidence). Then run from this repository on the GPU host:

```sh
mkdir -p work
curl -fsS http://127.0.0.1:8188/object_info -o work/object-info.json
node scripts/check-models-lock.mjs --definitions work/object-info.json
node scripts/check-open-weights.mjs --definitions work/object-info.json

python3 -m venv /opt/open-photon-proxy
/opt/open-photon-proxy/bin/pip install comfy-api-proxy==0.1.6
/opt/open-photon-proxy/bin/comfy-api-proxy run --comfyui http://127.0.0.1:8188 \
  --comfyui-base-dir "$COMFYUI_DIRECTORY" --host 0.0.0.0 --port 8189 --token "$PROXY_TOKEN" \
  --max-upload-mb 128 --state-dir /workspace/open-photon-proxy-state
```

Keep the proxy process running. The persistent state directory preserves the proxy's job and idempotency records. If ComfyUI lacks node classes, update it and restart before submitting. The graph uses ComfyUI core nodes; adding a paid partner node is not a workaround. The [proxy documentation](https://github.com/Comfy-Org/comfy-api-proxy#cli-reference) describes its flags. Expose port 8189, then point the app at it as in [SETUP.md](../SETUP.md) (set the two variables, `npm run check:comfy`).

### Loopback alternative: an SSH tunnel

The proof kept the proxy on loopback and reached it through an SSH tunnel, so no port was public. Start the proxy without `--host` and `--token` (the image: `PROXY_HOST=127.0.0.1`, no `PROXY_TOKEN`), then forward it from your machine:

```sh
ssh -N -L 127.0.0.1:8189:127.0.0.1:8189 -p <ssh-port> root@<pod-host>
```

A native `npm run dev` then uses `COMFY_BASE_URL=http://127.0.0.1:8189` and a blank `COMFY_API_KEY`. The Compose app reaches the tunnel at `COMFY_BASE_URL=http://host.docker.internal:8189` from Docker Desktop; Colima may require `host.lima.internal` instead.

## Model provenance

The five hashes come from the Hugging Face LFS SHA-256 metadata of [Comfy-Org/Wan-Animate-2 at e7181fe](https://huggingface.co/Comfy-Org/Wan-Animate-2/tree/e7181fe1896b7f2ce34120d1a3663413548240d7). Its model card declares Apache-2.0. These are expected deployment pins; a Cloud recipe cannot independently attest to the remote provider's on-disk bytes. Self-host installation verifies the actual bytes against the lock.
