# syntax=docker/dockerfile:1
# The GPU side of a self-hosted Open Photon: ComfyUI on loopback 8188 and comfy-api-proxy (the
# Comfy API v2 the app speaks) on 8189. Build from the repository root, for x86_64 GPU hosts:
#
#   docker build --platform linux/amd64 -f selfhost/Dockerfile -t <registry>/open-photon-comfy:<tag> .
#
# Base: the CUDA base image plus a fresh, pinned ComfyUI clone, rather than the Runpod ComfyUI
# image the 2026-10-21 proof started from. That image ships ComfyUI 0.30.0 (too old for this
# workflow) inside a template-specific /workspace layout it copies at boot; a pinned clone on a
# pinned base rebuilds the same way anywhere. The PyTorch wheels bring their own CUDA libraries,
# so the minimal `base` flavour suffices; it sets the NVIDIA runtime variables the host's
# container toolkit needs. Ubuntu 24.04's python3 is 3.12.3, the proof's interpreter.
FROM nvidia/cuda:13.0.2-base-ubuntu24.04@sha256:2ab6381d970b211fb93853796dc6707eb8a72575a375c422b17cf4d8b2641701 AS runtime

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git python3 python3-venv tini \
  && rm -rf /var/lib/apt/lists/*

# PyTorch first (the heaviest layer, and it changes least): the proof's 2.10.0+cu130. The
# constraints file keeps it there: a dependency that wanted another torch fails the build instead
# of swapping in a different CUDA build from PyPI.
RUN python3 -m venv /opt/venv/comfyui \
  && printf 'torch==2.10.0\ntorchvision==0.25.0\ntorchaudio==2.10.0\n' > /opt/venv/comfyui/torch.txt \
  && /opt/venv/comfyui/bin/pip install --index-url https://download.pytorch.org/whl/cu130 \
    -r /opt/venv/comfyui/torch.txt

# ComfyUI core at the proof's commit (0.42.0): it has WanAnimate2ToVideo, WanAnimate2Cache and
# the loop nodes the workflow uses. Its own requirements pin its frontend and kernels; the rest
# resolve at build time (every one has a cp312 x86_64 wheel, so no compiler is needed).
ARG COMFYUI_COMMIT=7a28332047b6af638dc6c7f72ef3481a718769fd
RUN git init -q /opt/ComfyUI \
  && git -C /opt/ComfyUI fetch -q --depth 1 https://github.com/Comfy-Org/ComfyUI.git "$COMFYUI_COMMIT" \
  && git -C /opt/ComfyUI checkout -q --detach FETCH_HEAD \
  && rm -rf /opt/ComfyUI/.git \
  && /opt/venv/comfyui/bin/pip install -c /opt/venv/comfyui/torch.txt -r /opt/ComfyUI/requirements.txt

# The proxy in its own environment, so its dependencies never move ComfyUI's.
RUN python3 -m venv /opt/venv/comfy-api-proxy \
  && /opt/venv/comfy-api-proxy/bin/pip install comfy-api-proxy==0.1.6

# Node 24, the app image's exact build, for the repository's model scripts.
COPY --from=node:24.19.0-bookworm-slim /usr/local/bin/node /usr/local/bin/node

FROM node:24.19.0-bookworm-slim AS scripts
WORKDIR /opt/open-photon
RUN npm install --global npm@11.6.2
# The scripts import zod (through the shared modules); install from the lockfile, as the app does.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM runtime
WORKDIR /opt/open-photon
COPY --from=scripts /opt/open-photon/node_modules ./node_modules
COPY package.json ./
COPY scripts/install-models.mjs scripts/check-models-lock.mjs ./scripts/
COPY src/shared/server/comfy-workflows.ts \
  src/shared/server/models-lock.ts \
  src/shared/server/workflow-graph.ts \
  ./src/shared/server/
# Every feature's workflows/: its runtime workflows and the models.lock beside them.
COPY --parents src/features/*/workflows ./
COPY --chmod=755 selfhost/entrypoint.sh ./selfhost/entrypoint.sh
COPY selfhost/proxy.py ./selfhost/proxy.py

# Weights, ComfyUI's inputs/outputs and the proxy's job records go under /workspace, where Runpod
# mounts the pod's volume (entrypoint.sh: MODELS_DIR, COMFYUI_DATA_DIR, PROXY_STATE_DIR).
# The source label ties the GHCR package to the repository (visibility and the package page follow it).
LABEL org.opencontainers.image.source="https://github.com/WojciechJelen/open-photon" \
  org.opencontainers.image.description="Open Photon self-hosted Comfy target: ComfyUI behind comfy-api-proxy (API v2) on 8189"
EXPOSE 8189
ENTRYPOINT ["tini", "-s", "--", "/opt/open-photon/selfhost/entrypoint.sh"]
