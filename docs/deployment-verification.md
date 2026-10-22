# Docker release verification — 2026-10-22

Release source: `27bc330`. [Release CI](https://github.com/WojciechJelen/open-photon/actions/runs/39855524385)
passed before publishing the version tags. The app uses one image for both backends;
ComfyUI and the model weights run remotely on the GPU host.

## Published images

| Image | Platforms | Manifest SHA-256 |
| --- | --- | --- |
| `ghcr.io/wojciechjelen/open-photon:0.1.0` | Linux AMD64, ARM64 | `5fff2a539035d8718f7b1f04f100066fbef1977d5e6fcbca319a2a15060db6a9` |
| `ghcr.io/wojciechjelen/open-photon-comfy:0.1.0` | Linux AMD64 | `7712c3db61647baeaab1a82c6a7d54223c25492306122a5b1b6a22704f1f128e` |

Both packages are public. The app was pulled without registry credentials. Cloud
was tested on the ARM64 build later promoted to `0.1.0`; its layers and configuration
were compared with the final tag, then the container was replaced using that tag.
The ARM64 manifest is `40014e589976cc82ce7b125f3ada39a3de3a0f244118c1c808a2d33c7d97a555`.
Native AMD64 startup, access, uploads, memory and volume permissions passed in CI.

## Live generations

Each mode uses a separate, initially empty application volume and only its backend
settings. Tests sign in with a freshly minted code, upload a bundled motion, submit
through the app API, consume its event stream, and download the result and recipe.
No SSH setup or manual installation is used on the GPU host.

| Backend | App generation | Submission to done | Output duration |
| --- | --- | --- | --- |
| Comfy Cloud | `a9919225-3d37-46b5-9512-5422ad1b6cdc` | 71.464 s | 5.016584 s |
| Runpod A40, CA-MTL-1 | `d6b16531-1e2b-4916-a0f0-0080366ce63e` | 149.050 s | 3.200066 s |

Cloud output SHA-256: `1f3af4158a3b5ea5bdd5abb9c0321ade3d388e20fee6b9a0214941d1fefbfd0b`.
Workflow SHA-256: `ef8b31e822968f27fd80409d7158a6d7c2ca46cf96b8814427ad15b180a3b1a9`.
All five recipe model pins match the repository's lock exactly. The Cloud output
passes full H.264/audio decoding and has 0.995162 audio correlation with the source.
Browser playback, public sharing, HTTP range playback, deduplicated recipe re-run,
and result persistence after replacing the container passed.

Runpod output SHA-256: `240e238563b81eb443ff7198fff9505f27d579950afc68ef9cb1ed812f0620d5`.
Its workflow hash and all five model pins match Cloud. The input is a newly encoded
3.2-second clip, so the final test exercises an uncached upload on its first attempt.
The output passes full H.264/audio decoding, with 0.999602 source-audio correlation.
Six app event snapshots cover the generation; all proxy job and output links use
the public HTTPS origin. Browser playback, public sharing, HTTP range playback,
deduplicated recipe re-run, and persistence of the result and access code after
restarting the app with the GPU pod already deleted all pass.

The A40 pod first booted from empty storage, automatically downloaded and verified
all five models, and served the proxy without SSH. The final GPU image replaced the
earlier candidate on that same persistent volume and verified all model hashes again.
The final app container used a fresh volume, the published `0.1.0` image and only
`COMFY_BASE_URL` plus `COMFY_PROXY_TOKEN`; no tracing hooks or preparatory asset uploads
were used. Ten independent, previously unseen hash probes returned `404` on the first
HEAD request through Runpod, with empty bodies and `Cache-Control: private, no-store`.
Missing and incorrect proxy tokens returned `401`.

## Cleanup and evidence

All three pods created during verification were terminated, including a pod that
never reached startup. The final pod lookup returned `404` and the account's pod list
was empty. No network volumes were created. The public
[Runpod template](https://console.runpod.io/deploy?template=iqcvzqgt1q) remains available.

Temporary app containers and their named volumes were removed, as were test copies
of environment files, access codes and the proxy token. The existing app on port 3030
remains healthy and its original `.env` hash is unchanged. Local reports, recipes,
event logs, screenshots and MP4 results remain under ignored `work/deployment-release/`;
the final proof files use the `cloud-release` and `selfhost-release` prefixes.

## Regression coverage

- `npm run check`: types, lint, formatting, dead code and duplicate code checks pass.
- `npm run test:server`: 96 tests pass.
- `npm run test:e2e`: 48 browser tests pass.
- Four Python proxy integration/configuration tests pass against `comfy-api-proxy==0.1.6`.
- Model locks, open-weights checks and private-file/client-secret checks pass.
- Both Dockerfiles pass build checks; Compose configuration and the GPU entrypoint's shell syntax pass.
- Real app containers reject missing configuration, mixed Cloud/proxy credentials,
  orphan proxy tokens and credential-bearing URLs before serving requests, without
  printing credentials. The SDK transport test verifies that a Cloud key cannot
  reach the proxy, and that the proxy receives its separate bearer token.
- Live diagnostics accept valid Cloud/proxy credentials and reject incorrect ones.
  The Runpod proxy also rejects an absent token with `401`.

## Findings resolved during verification

Runpod's gateway rewrites the upstream host. The stock proxy therefore emitted
internal HTTP links for job events and output files. The GPU image now supplies a
fixed public origin derived from `RUNPOD_POD_ID`; another gateway can use
`PROXY_PUBLIC_URL`. Tests cover job, asset and output URLs, ignored forged forwarding
headers, bearer authentication and the original cross-site guard. The app continues
to use the same unmodified SDK integration for both backends.

Runpod wraps the container entrypoint, so Tini now runs as a child subreaper (`-s`).
The release pipeline also uses a bounded Ubuntu package mirror configuration after
two earlier runs stalled downloading FFmpeg. Those runs were cancelled.

Cold Runpod uploads initially failed with `405`. An isolated fresh-hash probe
returned `405` with `Allow: HEAD` on its first request, then `404` on repetition.
This matches [Cloudflare's documented HEAD-to-GET conversion on a cache miss](https://developers.cloudflare.com/cache/concepts/cache-behavior/).
The stock proxy's hash route accepts only HEAD. The launcher now exposes GET through
the same upstream handler and marks responses `private, no-store`. Regression tests
cover missing/existing hashes through both methods and rejection without credentials.
No automatic retry or provider-specific workaround was added to the application.

Preliminary Runpod renders completed in 240.780 s on RTX A6000 and 182.918 s on A40.
They exposed the integration problems above; the final proof uses the corrected image.
