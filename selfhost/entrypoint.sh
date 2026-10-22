#!/usr/bin/env bash
# Installs and verifies the pinned weights, starts ComfyUI on loopback, checks it can run every
# workflow, then serves the Comfy API v2 (comfy-api-proxy) on port 8189. Stops when either
# process stops, and passes a stop signal to both.
set -euo pipefail

# The app sends this as COMFY_PROXY_TOKEN. Required unless the proxy stays on loopback (an SSH tunnel).
PROXY_TOKEN=${PROXY_TOKEN:-}
PROXY_HOST=${PROXY_HOST:-0.0.0.0}
# The model directory in ComfyUI's own layout (<directory>/<file>, as each models.lock names them).
export MODELS_DIR=${MODELS_DIR:-/workspace/models}
COMFYUI_DATA_DIR=${COMFYUI_DATA_DIR:-/workspace/comfyui}
PROXY_STATE_DIR=${PROXY_STATE_DIR:-/workspace/comfy-api-proxy}
# The app accepts uploads up to 128 MiB (MAX_UPLOAD_BYTES, src/shared/server/upload.server.ts).
# The proxy's limit is per file in MiB and allows the multipart envelope on top; it forwards each
# file to ComfyUI's /upload/image, whose own default is 100 MiB, so ComfyUI gets the same cap.
MAX_UPLOAD_MB=${MAX_UPLOAD_MB:-128}
export PROXY_TOKEN PROXY_HOST PROXY_STATE_DIR MAX_UPLOAD_MB

COMFYUI_DIR=/opt/ComfyUI

if [[ -z $PROXY_TOKEN && $PROXY_HOST != 127.0.0.1 ]]; then
  echo "PROXY_TOKEN is required when the proxy listens on $PROXY_HOST." \
    "Set it (the app's COMFY_PROXY_TOKEN), or PROXY_HOST=127.0.0.1 to serve on loopback only." >&2
  exit 64
fi

cd /opt/open-photon

pids=()

stop() {
  trap - TERM INT
  if ((${#pids[@]})); then
    kill -TERM "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}
trap 'stop; exit 143' TERM INT

# Bash runs a trap only between commands, so a long step runs in the background and is awaited:
# a stop signal then reaches it (through `stop`) instead of waiting for it to finish.
run() {
  "$@" &
  pids+=("$!")
  local status=0
  wait "$!" || status=$?
  unset 'pids[-1]'
  return "$status"
}

# Downloads what is missing and checks every file's SHA-256 against every feature's models.lock
# (src/features/<feature>/workflows/models.lock); a mismatch or a conflicting pin stops.
run node scripts/install-models.mjs "$MODELS_DIR"

mkdir -p "$COMFYUI_DATA_DIR/input" "$COMFYUI_DATA_DIR/output" "$PROXY_STATE_DIR"

/opt/venv/comfyui/bin/python "$COMFYUI_DIR/main.py" --listen 127.0.0.1 --port 8188 \
  --models-directory "$MODELS_DIR" \
  --input-directory "$COMFYUI_DATA_DIR/input" \
  --output-directory "$COMFYUI_DATA_DIR/output" \
  --max-upload-size "$((MAX_UPLOAD_MB + 1))" &
comfyui=$!
pids+=("$comfyui")

object_info=$(mktemp)
echo "Waiting for ComfyUI on 127.0.0.1:8188"
until curl --fail --silent --max-time 30 --output "$object_info" http://127.0.0.1:8188/object_info; do
  if ! kill -0 "$comfyui" 2>/dev/null; then
    status=0
    wait "$comfyui" || status=$?
    echo "ComfyUI exited ($status) before it served /object_info." >&2
    exit $((status == 0 ? 1 : status))
  fi
  sleep 2 &
  wait "$!"
done

# Preflight, for every runtime workflow: each node class it uses exists in this ComfyUI, and each
# model file it loads is among the choices of the loader field that names it (so ComfyUI found it
# in that loader's directory under MODELS_DIR).
run node scripts/check-models-lock.mjs --definitions "$object_info" || {
  stop
  exit 1
}
rm -f "$object_info"

# Collects the exit status of the process $2 (named $1), logs it, stops the other, and exits
# non-zero. Bash keeps a finished child's status for `wait <pid>` even once it left the job table.
exited() {
  local status=0
  wait "$2" || status=$?
  echo "$1 exited ($status); stopping." >&2
  stop
  exit $((status == 0 ? 1 : status))
}

if ! kill -0 "$comfyui" 2>/dev/null; then
  exited ComfyUI "$comfyui"
fi

echo "Serving the Comfy API v2 on $PROXY_HOST:8189 (auth: $([[ -n $PROXY_TOKEN ]] && echo bearer || echo none))"
/opt/venv/comfy-api-proxy/bin/python selfhost/proxy.py &
proxy=$!
pids+=("$proxy")

# Whichever stops first takes the other down: the container restarts as a whole. Polled by pid
# rather than `wait -n`, which misses a process that ended before it ran (during the preflight).
# The sleep runs in the background and is awaited so a stop signal still runs the trap at once.
until ! kill -0 "$comfyui" 2>/dev/null || ! kill -0 "$proxy" 2>/dev/null; do
  sleep 2 &
  wait "$!"
done
if ! kill -0 "$comfyui" 2>/dev/null; then
  exited ComfyUI "$comfyui"
fi
exited comfy-api-proxy "$proxy"
