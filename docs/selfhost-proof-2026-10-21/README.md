# RTX 5090 proof, 2026-10-21

Generation `301917e1-7798-4a03-af37-049bc82faee2` completed through the production app at commit `942a3092678d3fb9d30d06f3e3f76d2c9565009a`, with `COMFY_BASE_URL=http://127.0.0.1:8189` through an SSH tunnel to `comfy-api-proxy` on Runpod. The workflow and SDK adapter were unchanged. The isolated local database was `work/selfhost/app.sqlite`.

- [Report](report.json): 480×848, 5.016584 seconds, 158.717 seconds from submission to done, peak 31,066 MiB. This first render includes cold model loading. ComfyUI logged 157.91 seconds for prompt execution.
- [Generation](generation.json) and [recipe](recipe.json): `done`, `target: selfhost`, workflow SHA-256 and five model pins. The installer verified the actual model files against `models.lock` before submission.
- [GPU samples](vram.csv): UTC, one-second intervals, spanning submission and completion. This is total GPU memory reported by `nvidia-smi`, rather than a PyTorch allocation estimate.
- [Runtime](runtime.txt): ComfyUI 0.42.0 at `7a28332047b6af638dc6c7f72ef3481a718769fd`, PyTorch 2.10.0+cu130, proxy 0.1.6, NVIDIA driver 595.91.07.
- [Result MP4](result.mp4): H.264 video and AAC audio; both streams decode with FFmpeg without errors. SHA-256 is recorded in the report.
- [Browser observation](playback.png): Chrome compare playback reached the end at 5.016584 seconds, `readyState: 4`, no media error, result unmuted. Frames show the reference character performing the driving motion.
- [Audio comparison](audio-comparison.json): source and result decoded to mono 16 kHz float PCM, 80,620 aligned samples, normalized correlation 0.995162 and signal-to-error ratio 20.152 dB. This verifies the source audio survived AAC re-encoding; the compressed audio packets are not identical. No separate claim of a human listening test is made.

Inputs: `src/features/motionTransfer/samples/motions/street-dance.mp4` and `fixtures/wan/reference.png`, seed 20261021. Their hashes are in the recipe. The optional non-LoRA base variant was not benchmarked.

The official Runpod template was `wgd3p4n4o6`, image `runpod/comfyui:1.3.3-comfyuiv0.30.0-cuda13.0`, one RTX 5090 in EU-RO-1, 150 GB container disk and 100 GB persistent volume. Its original ComfyUI 0.30.0 lacked five required core nodes; updating the core and its dependencies made the preflight pass. See [reproduction commands](../selfhost.md).

The pod was stopped after evidence collection; read-back status was `EXITED` with only `start` and `terminate` available. GPU billing ended. Its retained 100 GB disk continues to cost the quoted $0.028/hour until terminated. The approximately 11-minute setup and render at the quoted $1.22/hour is about $0.22, rather than a reconciled billing total.
