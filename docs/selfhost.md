# Runpod 5090 proof

The commands below reproduce the Phase 8.3 GPU proof through the existing app and workflow.

## Pod requirements

- One NVIDIA GeForce RTX 5090, 32 GB VRAM, with no other workload running.
- A recent ComfyUI template with CUDA/PyTorch support for the 5090. The proof used official template `wgd3p4n4o6`, image `runpod/comfyui:1.3.3-comfyuiv0.30.0-cuda13.0`, with a 150 GB container disk and 100 GB persistent volume. Its bundled ComfyUI 0.30.0 lacks the required Wan Animate 2 and loop nodes; update it before generating. ComfyUI core must include `WanAnimate2ToVideo`, `WanAnimate2Cache`, and the loop nodes in the workflow. The preflight below checks all required node classes.
- At least 80 GB persistent disk for ComfyUI, its environment, approximately 26 GB of weights and outputs. Use 100 GB if the fused distilled or non-LoRA base variants will also be measured.
- SSH access. The proxy can stay bound to loopback and reach the app through an SSH tunnel; no public ComfyUI or proxy port is needed.
- Node 24+ for the repository scripts and Python 3.10+ for `comfy-api-proxy`.

After creating the pod, provide its pod ID, SSH command, and ComfyUI directory. No API keys need to be pasted into this chat.

## Install the exact model files

On the pod, clone this repository and enter its directory. Set `COMFYUI_DIRECTORY` to the template's actual ComfyUI directory, for example `/workspace/runpod-slim/ComfyUI`.

```sh
export COMFYUI_DIRECTORY=/workspace/runpod-slim/ComfyUI
npm install -g npm@11.6.2
npm ci --omit=dev
node scripts/check-models-lock.mjs
node scripts/install-models.mjs "$COMFYUI_DIRECTORY/models"
node scripts/install-models.mjs "$COMFYUI_DIRECTORY/models" --verify-only
```

The installer streams each download, verifies SHA-256 before renaming it into place, and skips files whose hashes already match. A mismatched existing file stops the script so a template's weights are not silently replaced. Downloads use immutable Hugging Face revision URLs from [models.lock](../models.lock).

The first proof uses the **unchanged** v1 workflow: `wan_animate_2_int8_convrot.safetensors` plus the lightx2v distillation LoRA, six steps, 480×848 for a portrait clip. The fused `wan_animate_2_distill_int8_convrot.safetensors` is a different model file and is not substituted under the base model's filename. Any later variant needs its own workflow hash and lock entry before it can be reported as reproducible.

## Check ComfyUI and start the v2 proxy

The proof used ComfyUI 0.42.0 at commit `7a28332047b6af638dc6c7f72ef3481a718769fd`, PyTorch `2.10.0+cu130`, Python 3.12.3 and NVIDIA driver 595.91.07. With the official template above, update its core and install dependencies into its existing virtual environment:

```sh
cd "$COMFYUI_DIRECTORY"
git fetch --depth 1 https://github.com/Comfy-Org/ComfyUI.git \
  7a28332047b6af638dc6c7f72ef3481a718769fd
git checkout --detach 7a28332047b6af638dc6c7f72ef3481a718769fd
.venv-cu128/bin/python -m pip install -r requirements.txt
```

Stop the template's existing `main.py` process before starting the updated core with `.venv-cu128/bin/python main.py --listen 127.0.0.1 --port 8188`. The template keeps SSH alive when ComfyUI exits. Install Node 24 outside `/workspace` (for example `/opt/open-photon-node`); this template's persistent filesystem rejects archive ownership changes, so extract it with `tar --no-same-owner`.

Start the template's ComfyUI on loopback port 8188, then run from this repository on the pod:

```sh
mkdir -p work
curl -fsS http://127.0.0.1:8188/object_info -o work/object-info.json
node scripts/check-models-lock.mjs models.lock \
  src/features/motionTransfer/workflows/motion-transfer.v1.json work/object-info.json
node scripts/check-open-weights.mjs src/features/motionTransfer/workflows \
  --definitions work/object-info.json

python3 -m venv /opt/open-photon-proxy
/opt/open-photon-proxy/bin/pip install comfy-api-proxy==0.1.6
/opt/open-photon-proxy/bin/comfy-api-proxy run --comfyui http://127.0.0.1:8188 \
  --comfyui-base-dir "$COMFYUI_DIRECTORY" --port 8189 \
  --max-upload-mb 128 --state-dir /workspace/open-photon-proxy-state
```

Keep the proxy process running. The persistent state directory preserves the proxy's job and idempotency records. If the template lacks node classes, update its ComfyUI and restart before submitting. The graph uses ComfyUI core nodes; adding a paid partner node is not a workaround.

The [proxy documentation](https://github.com/Comfy-Org/comfy-api-proxy#cli-reference) describes its flags. A direct public endpoint instead needs `--host 0.0.0.0 --token "$PROXY_TOKEN"`; set the app's `COMFY_API_KEY` to that bearer token. For the loopback tunnel below, leave the key empty.

## Point the app at the pod

On your Mac, forward the pod's proxy using its SSH connection details. For a direct SSH endpoint:

```sh
ssh -N -L 127.0.0.1:8189:127.0.0.1:8189 -p <ssh-port> root@<pod-host>
```

In another terminal, from the local repository:

```sh
docker compose stop app
COMFY_BASE_URL=http://host.docker.internal:8189 COMFY_API_KEY= \
  docker compose --profile selfhost up --build -d selfhost
docker compose exec selfhost node scripts/mint-code.mjs selfhost-proof 5
```

The app is on `http://localhost:3030`. Enter that access code when asked. The profile has its own `selfhost-data` volume. `host.docker.internal` reaches the SSH tunnel from Docker Desktop; Colima may require `host.lima.internal` instead. Verify connectivity with `/api/v2/health` from the container before generating. A native `npm run dev` can use `COMFY_BASE_URL=http://127.0.0.1:8189 COMFY_API_KEY=` directly.

The app's provider adapter is unchanged. Its SDK reads `COMFY_BASE_URL` and optional `COMFY_API_KEY`; port 8188 serves native ComfyUI, while 8189 serves the v2 API the SDK uses. A non-Cloud origin records `target: selfhost` and prevents deduplication against Cloud renders.

## Record and verify one render

On the pod, start recording before clicking Generate:

```sh
mkdir -p work
TZ=UTC nvidia-smi --query-gpu=timestamp,name,memory.used \
  --format=csv,noheader,nounits -l 1 | tee work/vram.csv
```

In the app, pick a 3–8 second motion with audible sound and a sample character, then Generate. Keep the recording running until the app reaches `done`. Play the compare view, confirm the character moves, and listen for the driving clip's audio once. Copy the generation ID from `/g/<id>`. Stop the GPU recording and copy `work/vram.csv` from the pod to the local repository's `work/vram.csv`.

Verify locally with the access code minted on the selfhost database, set in the environment:

```sh
BASE_URL=http://localhost:3030 VRAM_CSV=work/vram.csv \
  node scripts/verify-selfhost.mjs <generation-id>
```

`ACCESS_CODE` must also be set. The script checks the stored `done` generation, `target: selfhost`, workflow hash and all five model pins; downloads and decodes the H.264 output with audio; and writes `work/selfhost-<id>.json` with elapsed seconds and peak MiB measured during this generation. It rejects a recording that does not span the render. Playback and matching the source audio still require observation.

Fill the README row from that report and record the playback observation in CHECKLIST.md. Keep the GPU CSV, recipe JSON and output as evidence. If the workflow runs out of VRAM, retain the error and record the limit before trying a separately pinned variant. Phase 8.3 stays open until a render succeeds through the app.

After recording the evidence, stop the paid pod in Runpod. To return the local app to Cloud:

```sh
docker compose stop selfhost
docker compose up -d app
```

## Model provenance

The five hashes come from the Hugging Face LFS SHA-256 metadata of [Comfy-Org/Wan-Animate-2 at e7181fe](https://huggingface.co/Comfy-Org/Wan-Animate-2/tree/e7181fe1896b7f2ce34120d1a3663413548240d7). Its model card declares Apache-2.0. These are expected deployment pins; a Cloud recipe cannot independently attest to the remote provider's on-disk bytes. Self-host installation verifies the actual bytes against the lock.
