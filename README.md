# Open Photon

TanStack Start v1 with typed routes, SQLite, the official Wan Animate 2 workflow, Comfy SDK progress over SSE, streamed uploads, video byte ranges, and server-rendered share metadata.

Start is pinned to `1.169.3`; the registry does not publish an exact `1.0.0`. The app uses Tailwind 4, shadcn components, and Node's built-in SQLite module. Node 24 and FFmpeg are included in the production image.

## Run

Put `COMFY_API_KEY=...` in the ignored `.env` file. The account needs access to Comfy Cloud workflow generation and enough credits. Authentication alone does not establish this access. Supply the key only at runtime.

```sh
docker build --platform linux/amd64 -t open-photon:latest .
docker run -d --name open-photon --platform linux/amd64 --init \
  --env-file .env -e COMFY_BASE_URL=https://cloud.comfy.org \
  -p 127.0.0.1:3030:3000 \
  --mount type=volume,source=open-photon-data,target=/app/data \
  open-photon:latest
```

For Colima, add `--context colima` after `docker`. Stop the running app before building on a small Docker VM. `docker compose up --build -d` is an alternative using the key from `.env`; it uses a separate Compose volume. Keep the volume containing your render data when replacing containers.

Open <http://localhost:3030>, follow the typed link to the studio, and submit a render. **This submits a real GPU job and uses Comfy credits.** The reference image and driving video are the official public samples. The prompt describes the character and background; motion comes from the driving video. See [workflow provenance and bindings](workflows/wan-animate-2/README.md).

For local development, use Node 24+ and npm 11.6.2 (`npm install --global npm@11.6.2`), then `npm ci` and `npm run dev`. Docker and CI use the same npm version declared in `packageManager`. Install FFmpeg locally to save and verify generated outputs.

## One live run

Against the running app:

```sh
WAN_RESTART_AFTER_ACCEPT=1 node scripts/run-wan.mjs
```

The script saves its request ID before submitting, restarts the container after acceptance, recovers the same provider job, consumes SSE, and downloads the finished MP4 to `data/renders`. It checks the SHA-256, a 100-byte range response, raw SSR video metadata, and duplicate-request reuse. It saves evidence in `work/wan-run.json` and `work/wan-live-events.ndjson`.

Re-running resumes that saved request; it does not intentionally create another render. Use `WAN_RUN_FILE` to choose a distinct request record only when you intend to start another job. A known rejected request stays failed. `WAN_OUTPUT_DIRECTORY`, `BASE_URL`, `SPIKE_CONTAINER`, and `SPIKE_DOCKER_CONTEXT` override local defaults.

Verified on 2026-10-18 with one accepted real Comfy job. The app recovered its provider ID after a restart, streamed live progress, and saved a 480×848 H.264 MP4 with AAC audio, 121 frames, and a 5.017-second duration. Browser playback and seeking, output checksum, Range 206, raw SSR video tags, and duplicate-request reuse passed. This was one observed run, not a guarantee of provider availability or recovery in every failure mode. Detailed run records are kept privately.

## Render state and recovery

- The server function `createJob` and `POST /api/jobs` share one submission path. Inputs include a client-generated UUID. SQLite inserts it once and repeated requests return the existing row. Reusing an ID with different inputs is rejected.
- The app stores the exact API graph and accepted Comfy job ID. `GET /api/jobs/:id`, route loaders, and SSE reconcile actual provider status. Elapsed time never marks a render complete.
- After provider success, the app streams output `246` to a temporary file, checks its byte size and FFprobe metadata, creates a poster, hashes the MP4, and renames the files into the media directory. Only then does SQLite record completion.
- If the app restarts after storing the provider ID, the next read can recover provider state and download its output. A disconnected browser stops its SDK event subscription; the provider job continues remotely.
- There is a remaining crash window between provider acceptance and saving its ID. Comfy's SDK describes idempotency keys as single-use, without replay, and the tested Cloud job-list endpoint returned 501. The app marks an interrupted submission `unknown` and refuses automatic resubmission. Check the Comfy queue before starting another render.
- Output collection has an in-process lock. Run one app instance against this SQLite volume. Multi-instance submission and download coordination are outside this spike.

The new `renders` table retains real-job state separately from historical fake rows. Existing data is not deleted. SQLite and media default to `data/spike.sqlite` and `data/media`; override with `DATABASE_PATH` and `MEDIA_DIRECTORY`.

## Video routes

`POST /api/uploads` streams one multipart MP4 to disk through Busboy. The file limit is 128 MiB, with 64 KiB additional multipart overhead. Interrupted and rejected uploads remove partial files.

`GET` and `HEAD /media/:filename` support single byte ranges, suffix ranges, 206, and unsatisfiable-range 416 responses. `x.mp4` and `x.jpg` are playback test fixtures, not generated results.

SSE includes `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. `/r/:jobId` emits Open Graph tags in raw HTML; completed jobs reference their saved MP4. `/r/test` is explicitly a playback fixture. Set `PUBLIC_APP_URL` for absolute share URLs outside localhost.

## Verify

```sh
npm run check
npm run check:privacy
npm run test:server
npm run build
npm run check:client
```

With the app running on port 3030, run the browser tests:

```sh
npx playwright install chromium
npm run test:e2e
```

Additional checks against a dedicated running app with diagnostics enabled (`ENABLE_SPIKE_CHECKS=1`):

```sh
node scripts/verify-upload-memory.mjs
```

The upload-memory script runs six transfers against a dedicated test instance. Its memory measurements depend on the container environment and sampling interval. Historical simulation and detailed measurement records are private; simulated jobs are not evidence of real generation.

Browser cases in `tests/studio.spec.ts` consume `WAN_TEST_JOB_ID` instead of starting a paid job. They cover typed search, saved render reload, terminal state, and invalid input. The saved-live-render case is skipped when no existing render ID is supplied. Set `BASE_URL` to test an app on a different address.

## Continuous integration

[CI](.github/workflows/ci.yml) runs on pushes and pull requests once this repository is hosted on GitHub. It installs from the lockfile, checks types, lint and formatting, checks private paths across Git history, runs server tests, and builds the Linux AMD64 image (including its client-secret scan). Browser tests are run separately against a running app. CI uses no Comfy secrets and submits no paid jobs. The workflow can only be verified on GitHub after a remote is explicitly created and the repository is pushed.

`npm run check:privacy` requires a full Git checkout. It rejects tracked private paths and their historical document locations. Local notes belong in `docs/priv/`, which is excluded from both Git and the Docker context. An ignore rule cannot remove files already committed; run the privacy check before the first push as well as in CI.

## SDK and secrets

The SDK runs only in server modules. Vite externalizes it; Nitro traces the package into production output. `.env*` is excluded from Git and the Docker context. Every image build uses a dummy key and scans `.output/public` for credential configuration names and the canary value.

`/api/spike/comfy` checks typed NotFound against a deliberately nonexistent job. `/api/spike/status` reports subscription and memory counters. These require `ENABLE_SPIKE_CHECKS=1`; leave it unset outside diagnostics. The old fake-job creation route has been removed.

The Vite/Nitro build still emits upstream `use client` warnings.
