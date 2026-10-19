# Open Photon

TanStack Start v1 with typed routes, SQLite, the official Wan Animate 2 workflow, Comfy SDK progress over SSE, streamed uploads, video byte ranges, and server-rendered share metadata.

Start is pinned to `1.169.3`; the registry does not publish an exact `1.0.0`. The app uses Tailwind 4, shadcn components, and Node's built-in SQLite module. Node 24 and FFmpeg are included in the production image.

Docs: <https://open-photon-docs.vercel.app> ([source](https://github.com/WojciechJelen/open-photon-docs)).

## Run

Put `COMFY_API_KEY=...` in the ignored `.env` file. The account needs access to Comfy Cloud workflow generation and enough credits. Authentication alone does not establish this access. Supply the key only at runtime.

```sh
docker build -t open-photon:latest .
docker run -d --name open-photon --init \
  --env-file .env -e COMFY_BASE_URL=https://cloud.comfy.org \
  -p 127.0.0.1:3030:3000 \
  --mount type=volume,source=open-photon-data,target=/app/data \
  open-photon:latest
```

For Colima, add `--context colima` after `docker`. Stop the running app before building on a small Docker VM. `docker compose up --build -d` is an alternative using the key from `.env`; it uses a separate Compose volume. Keep the volume containing your render data when replacing containers.

Build and run natively: ARM64 on Apple Silicon, AMD64 on x86 hosts. Compose follows the Docker host architecture. CI builds the AMD64 image on an x86 runner. For an explicit cross-platform compatibility check, add `--platform linux/amd64` to both build and run, using a separate image tag and container. Earlier emulated runs had a route-generator segmentation fault and inconsistent memory measurements; use native runs for memory checks.

Open <http://localhost:3030>, follow the typed link to the studio, and submit a render. **This submits a real GPU job and uses Comfy credits.** The reference image and driving video are the official public samples. The prompt describes the character and background; motion comes from the driving video. See [the workflow, its provenance and its input map](workflows/README.md).

For local development, use Node 24+ and npm 11.6.2 (`npm install --global npm@11.6.2`), then `npm ci` and `npm run dev`. Docker and CI use the same npm version declared in `packageManager`. Install FFmpeg locally (with libx264): uploads are probed and trimmed with `ffprobe`/`ffmpeg`, the server tests run them, and generated outputs are verified with them.

## One live run

Against the running app:

```sh
WAN_RESTART_AFTER_ACCEPT=1 node scripts/run-wan.mjs
```

The script saves its request ID before submitting, restarts the container after acceptance, recovers the same provider job, consumes SSE, and downloads the finished MP4 to `data/renders`. It checks the SHA-256, a 100-byte range response, raw SSR video metadata, and duplicate-request reuse. It saves evidence in `work/wan-run.json` and `work/wan-live-events.ndjson`.

Re-running resumes that saved request; it does not intentionally create another render. Use `WAN_RUN_FILE` to choose a distinct request record only when you intend to start another job. A known rejected request stays failed. `WAN_OUTPUT_DIRECTORY`, `BASE_URL`, `SPIKE_CONTAINER`, and `SPIKE_DOCKER_CONTEXT` override local defaults.

Verified on 2026-10-18 with one accepted real Comfy job. The app recovered its provider ID after a restart, streamed live progress, and saved a 480×848 H.264 MP4 with AAC audio, 121 frames, and a 5.017-second duration. Browser playback and seeking, output checksum, Range 206, raw SSR video tags, and duplicate-request reuse passed. This was one observed run, not a guarantee of provider availability or recovery in every failure mode. Detailed run records are kept privately.

## Render once from a params file

```sh
node --env-file=.env scripts/render-once.mjs params/first-registry-render.json
```

The script submits straight to Comfy, without the app: it loads `workflows/motion-transfer.v1.json` and its input map, uploads the two files the params name, builds the graph with `buildGraph`, submits it with an idempotency key, follows the job's events and downloads output `246` to `work/render-once/<recipe>.mp4`. **It submits a real GPU job.** Before uploading, a run claims the recipe by creating `work/render-once/<recipe>.json` exclusively, so overlapping runs of the same params cannot both submit. The record is marked `submitting` before the submit and gets the job ID right after it, so running the same params file again resumes that job (or reports the finished download) instead of creating another. A record left without a job ID is never submitted again automatically, because Comfy forgets idempotency keys after 24 hours: the script exits non-zero and says how to resolve it (set `jobId` from Comfy Cloud, or delete the record once you are sure no job was created).

Credits per 5 s 480×848 render (distilled: lightx2v LoRA, 6 steps, int8 model): **≈17.5 credits** ($0.083 at 211 credits per dollar), for 64.9 s of GPU execution. Measured on 2026-10-19 from the workspace balance (`GET https://cloud.comfy.org/api/billing/usage/timeseries`, `summary.balance`) before and after one job; the base variant is not measured yet.

## Render state and recovery

- The server function `createJob` and `POST /api/jobs` share one submission path. Inputs include a client-generated UUID. SQLite inserts it once and repeated requests return the existing row. Reusing an ID with different inputs is rejected.
- The app stores the exact API graph and accepted Comfy job ID. `GET /api/jobs/:id`, route loaders, and SSE reconcile actual provider status. Elapsed time never marks a render complete.
- After provider success, the app streams output `246` to a temporary file, checks its byte size and FFprobe metadata, creates a poster, hashes the MP4, and renames the files into the media directory. Only then does SQLite record completion.
- If the app restarts after storing the provider ID, the next read can recover provider state and download its output. A disconnected browser stops its SDK event subscription; the provider job continues remotely.
- There is a remaining crash window between provider acceptance and saving its ID. Comfy's SDK describes idempotency keys as single-use, without replay, and the tested Cloud job-list endpoint returned 501. The app marks an interrupted submission `unknown` and refuses automatic resubmission. Check the Comfy queue before starting another render.
- Output collection has an in-process lock. Run one app instance against this SQLite volume. Multi-instance submission and download coordination are outside this spike.

The new `renders` table retains real-job state separately from historical fake rows. Existing data is not deleted. SQLite and media default to `data/spike.sqlite` and `data/media`; override with `DATABASE_PATH` and `MEDIA_DIRECTORY`. Uploaded and trimmed files live in `assets/` next to the database (`data/assets/<sha256>.<ext>`), one row each in the `assets` table.

The app opens one SQLite connection per process (WAL, `busy_timeout` 5000 ms, foreign keys on). When the server first loads its database module, it applies each `src/server/migrations/NNN-name.sql` not yet recorded in the `migrations` table, each in its own transaction. Add a schema change as the next numbered file; never edit an applied one. The production image copies the directory next to `.output`.

## Uploads and video routes

`POST /api/uploads` streams one multipart video (field `file`) through Busboy to a hidden temporary file in the assets directory, hashing it with SHA-256 on the way. The file limit is 128 MiB, with 64 KiB additional multipart overhead; a request that declares more gets 413 before anything is written. Interrupted and rejected uploads remove partial files.

`ffprobe` then decides what the file is; the filename and declared type are ignored. MP4, QuickTime and WebM files with a video stream of at least 3 s are accepted; anything else is a 422 with `reason` `no_video` or `too_short`, and leaves no file and no row. An accepted file moves to `<sha256>.<ext>` and gets an `assets` row (`role: upload`, with width and height as displayed, duration, frame rate and `has_audio`). The same bytes uploaded again return the stored row with 200 instead of 201.

A clip over 8 s is kept whole, and the response's `trimmed` field carries its first 8 s as a `trimmed` asset (video and audio, `source_asset_id` pointing at the upload). `POST /api/assets/:id/trim` with `{ "start_ms", "duration_ms" }` (3–8 s) cuts another range. A cut that starts on a keyframe is a stream copy; any other cut is re-encoded to H.264 and AAC. Either way the audio stays in sync, and the same cut returns the stored asset. The response contracts are documented in `src/lib/contracts.ts`.

On Node, uploads read the underlying HTTP stream directly with byte-based backpressure. This avoids the extra buffer copies from converting the incoming Node stream to a Web stream and back. Standard Web requests use the streaming fallback. HTTP tests cover both oversized chunked uploads returning 413 and disconnect cleanup.

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

Check upload memory in a dedicated container, using the native image built above (for Colima, use `--context colima` and set `SPIKE_DOCKER_CONTEXT=colima`):

```sh
docker run -d --name open-photon-memory --init \
  -e ENABLE_SPIKE_CHECKS=1 -p 127.0.0.1:3031:3000 open-photon:latest
SPIKE_DOCKER_CONTEXT=default SPIKE_CONTAINER=open-photon-memory \
  BASE_URL=http://127.0.0.1:3031 node scripts/verify-upload-memory.mjs
docker rm --force --volumes open-photon-memory
```

The upload-memory script requires an explicit container and HTTP address, restarts that container, and runs six transfers without Comfy credentials. It retains the 64 MiB limits for anonymous-memory growth, application RSS growth, and sampled array-buffer peaks; failures return a nonzero exit code. The report in `work/upload-memory.json` includes the image and Docker host architecture. Measurements depend on the container environment and sampling interval. Historical simulation and detailed measurement records are private; simulated jobs are not evidence of real generation.

Browser cases in `tests/studio.spec.ts` consume `WAN_TEST_JOB_ID` instead of starting a paid job. They cover typed search, saved render reload, terminal state, and invalid input. The saved-live-render case is skipped when no existing render ID is supplied. Set `BASE_URL` to test an app on a different address.

## Railway staging

The deployment test app is private. Railway builds the repository's Dockerfile in the `open-photon` project, `staging` environment. It runs one replica in Europe with a 1 CPU / 1 GB RAM limit and a 5 GB volume mounted at `/app/data`. Keep one replica while SQLite and output collection use local storage.

Runtime variables are `PORT=3000`, `HOST=0.0.0.0`, `DATABASE_PATH=/app/data/spike.sqlite`, `MEDIA_DIRECTORY=/app/data/media`, `COMFY_BASE_URL=https://cloud.comfy.org`, and `PUBLIC_APP_URL` (the deployment origin). Set `COMFY_API_KEY` as a service secret; leave spike diagnostics disabled.

Railway mounts volumes as root. `RAILWAY_RUN_UID=0` starts the entrypoint as root so it can create and assign the database and media directories to `node`, then `gosu` replaces it with the app running as UID 1000. Ordinary Docker runs still default to `USER node`. Existing files must already be writable by `node`; startup does not recursively change ownership of stored media.

Railway service settings select the Dockerfile builder, check `/healthz` with a 120-second health-check timeout, and restart on failure up to three times. The volume and runtime secrets also remain Railway configuration. We do not use the deprecated `railway.toml` format. The Dockerfile intentionally has no `VOLUME` instruction because Railway rejects it; local runs must explicitly mount storage as shown above.

## Continuous integration and deployment

[CI](.github/workflows/ci.yml) runs on every `main` push and pull request, and can be started manually. It installs from the lockfile, checks types, lint, formatting, unused code and duplication, checks private paths across Git history, runs server tests, builds the Linux AMD64 image (including its client-secret scan), and runs the six-upload memory check on the native x86 runner. The container starts with a fresh root-owned volume, and CI checks that the app runs as UID 1000 and can write SQLite on that volume. Browser tests are run separately against a running app. CI uses no Comfy secrets and submits no paid jobs.

Railway follows `main` with **Wait for CI** enabled. Each push must pass GitHub Actions before Railway builds and deploys the Dockerfile; failed checks block that deployment. Main-branch CI runs are not canceled by newer pushes. Pull-request checks do not deploy to staging. A successful Railway deployment must pass the HTTP health check before becoming active.

`npm run check:privacy` requires a full Git checkout. It rejects tracked private paths and their historical document locations. Local notes belong in `docs/priv/`, which is excluded from both Git and the Docker context. An ignore rule cannot remove files already committed; run the privacy check before the first push as well as in CI.

## SDK and secrets

The SDK runs only in server modules. Vite externalizes it; Nitro traces the package into production output. `.env*` is excluded from Git and the Docker context. Every image build uses a dummy key and scans `.output/public` for credential configuration names and the canary value.

`/api/spike/comfy` checks typed NotFound against a deliberately nonexistent job. `/api/spike/status` reports subscription and memory counters. These require `ENABLE_SPIKE_CHECKS=1`; leave it unset outside diagnostics. The old fake-job creation route has been removed.

The Vite/Nitro build still emits upstream `use client` warnings.

## Private preview access

Set `APP_ACCESS_CODE` to a random secret of 24–256 characters (for example, `openssl rand -hex 24`). Production fails closed when it is missing or invalid. Local development without the variable remains open. Supply it in `.env` for Docker and export it when running verification scripts or browser tests. Never commit the code.

Every dynamic page, API, server function, upload, event stream, and media request requires an access session. `/access` accepts the code and sets a signed, HttpOnly, SameSite cookie for 12 hours; HTTPS deployments also set Secure. Changing the code and redeploying invalidates existing sessions. Login attempts are limited to 10 per minute across this single instance. `/healthz` is public and reports readiness without touching Comfy. Static application assets remain public and contain no credentials.

This is a shared preview gate: anyone with the code can spend Comfy credits. It does not impose per-user spending limits. Protected pages and media are private, so public social-preview crawlers cannot access them. The deployment URL previously appeared in this README; removing it does not erase Git history or make it secret.
