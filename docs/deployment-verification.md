# Docker release verification

The release uses the same application image with either `COMFY_API_KEY` (Cloud),
or `COMFY_BASE_URL` and `COMFY_PROXY_TOKEN` (Runpod). Each test uses its own empty
application volume. The operator's existing app and `.env` are not changed.

Verification is in progress. Results and resource cleanup are recorded here after
live tests finish; this file does not claim a successful render yet.
