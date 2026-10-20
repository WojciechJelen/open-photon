# Open Photon

Genjutsu: film yourself moving, pick a character, and get a video of the character doing the same, rendered with the open-weights Wan Animate 2 workflow on Comfy. TanStack Start v1 with typed routes, SQLite, the Comfy SDK, streamed uploads and video byte ranges.

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

Open <http://localhost:3030>. The first step picks the motion: a grid of looping, muted sample clips, or an upload of your own (3–8 s; a longer clip opens a trim dialog). The second picks the character: a sample, or a photo you upload after ticking the likeness-consent box. Both choices are in the URL (`/?motion=<asset id>&character=<character id>`), so a reload keeps them; there are no accounts, so an uploaded character is listed only while the URL names it. The workflow, its provenance and its input map are described in [workflows/README.md](workflows/README.md).

For local development, use Node 24+ and npm 11.6.2 (`npm install --global npm@11.6.2`), then `npm ci` and `npm run dev`. Docker and CI use the same npm version declared in `packageManager`. Install FFmpeg locally (with libx264): uploads are probed and trimmed with `ffprobe`/`ffmpeg`, the server tests run them, and generated outputs are verified with them.

## Credits

Credits per 5 s 480×848 render (distilled: lightx2v LoRA, 6 steps, int8 model): **≈17.5 credits** ($0.083 at 211 credits per dollar), for 64.9 s of GPU execution. Measured on 2026-10-19 from the workspace balance (`GET https://cloud.comfy.org/api/billing/usage/timeseries`, `summary.balance`) before and after one job, and again (≈17.7 credits) for the Step 4.1 generation; the base variant is not measured yet.

## Generating

The `generate` server function (`src/lib/generate.functions.ts`, input `generateInputSchema` in `src/lib/contracts.ts`) takes a stored 3–8 s video asset (`motion_asset_id`: a sample motion's clip, an upload or a cut), a character (`character_id`), and optionally a prompt and a seed. **It submits a real GPU job and uses Comfy credits.** It refuses a clip that is missing, unprobed or longer than 8 s, and an uploaded character without consent. Then, in this order (`src/server/generate.ts`):

1. It builds the recipe (workflow id, version and SHA-256, the parameters, the SHA-256 of both input files, the target) and its `recipe_hash`. If a generation with that hash is done, or still on its way, it returns that generation's id with `reused: true` and submits nothing.
2. It inserts a `preparing` row with a fresh idempotency key.
3. It uploads both files to Comfy (content-addressed) and stores their references in `provider_inputs`.
4. It builds the graph with `buildGraph` and submits it with the row's idempotency key.
5. It stores the Comfy job id the moment `submit()` returns, and the row becomes `queued`.

The portrait size is 480×848 (848×480 for a landscape clip), `fragment_length` 81, the seed random unless given, the prompt the workflow's own unless given. An `angle` (`front`, `three-quarter`, `profile`; **placeholder phrasings** in `workflows/angles.json` until the angle benchmark has run) appends its phrasing to the prompt and is stored as the recipe's `angle`, so both change the `recipe_hash`; a recipe without one hashes as before. `GET /api/generations/:id` returns the generation (`generationSchema`; 400 for a malformed id, 404 for an unknown one).

The third step on `/` is the generate form: the reshoot angle ("As filmed" or a preset), an optional appearance and background description, and the seed under "Advanced". It is checked against `generateInputSchema` in the browser: an invalid form (no motion or character, a seed that is not a whole number, a description over 500 characters) says why and never calls the server. Generate opens `/g/<id>`; a reused recipe opens the same page, a done one straight to its result. That page streams the generation's events and shows only its status word and percent, never a time estimate. A failed generation shows its reason and "Retry with a new seed" (`POST /api/generations/:id/retry`, which opens the child); an `unknown` one explains why it is not retried.

`GET /api/generations/:id/events` streams the generation as server-sent events (`generationEventSchema`): a snapshot of the row, then one per change Comfy reports (`running`, progress), with a `: ping` comment every 15 s so proxies keep the connection open. Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` (the access middleware leaves it on event streams) and `X-Accel-Buffering: no`. A `done`, `failed` or `unknown` generation gets one snapshot and the stream ends without a Comfy call. Closing the request aborts the SDK subscription; the job continues on Comfy. 400 for a malformed id, 404 for an unknown one.

When the event stream ends, and on every `GET /api/generations/:id` of a `queued`, `running` or `finalizing` row, `finalize` (`src/server/finalize.ts`) asks Comfy for the job (`jobs.get` is the source of truth; elapsed time never completes a job). A job that is not complete leaves the row as it is; a failed, cancelled or expired one fails it. A succeeded one is downloaded (output `246`, which already carries the driving clip's audio, so nothing is muxed), probed, hashed and stored as a `provider_output` asset, a JPEG poster is cut at 0.5 s (the first frame for a shorter output) and stored as a `poster` asset, and the row becomes `done` with `final_asset_id`, `output_asset_id` and `poster_asset_id`. One finalize per generation runs at a time in the process; concurrent callers share it. A failed download leaves the row `finalizing`, counts `finalize_attempts` and is retried on the next read. Comfy's signed output URLs last about 6 hours, so a result is re-hosted the first time anyone looks after it finished.

`POST /api/generations/:id/retry` retries a `failed` generation: it creates a child (`parent_id` = `:id`) with the same recipe except a fresh random seed and submits it through the same path as `generate` (201 `{ id, reused }`). **It submits a real GPU job.** It answers 409 for a generation that is not `failed` (including `unknown`: see below), 404 for an unknown id, 400 for a malformed one.

## Generation state and recovery

A generation goes `preparing → queued → running → finalizing → done | failed`. A failed row has an `error_code` (listed on `generationErrorCodeSchema`) and a readable `error_message`. A Comfy answer that refuses the request, or a connection that never reaches Comfy, fails the row; nothing was rendered.

**`unknown`** is the crash window. If the server stops, or the submit request times out or breaks, after the graph may have reached Comfy but before the job id was stored, nobody knows whether Comfy is rendering it. Comfy's idempotency keys are single-use, without replay, and Comfy Cloud has no job list to look the key up in (`listJobs` returns 501). So the row becomes `unknown`, and the app never submits it again: not on the next read, not as a reuse of its recipe, and not as a retry (`POST /api/generations/:id/retry` answers 409 and points here). What to do: look for a job created at the row's `created_at` in your Comfy Cloud account. If you find one, its output is in your Comfy history. Either way, start a new generation with another seed. A `preparing` row left by a stopped server is settled on its next read or the next `generate` of its recipe: `unknown` if its files were uploaded (the submit may have been sent), else `failed` with `interrupted` (nothing was sent, so that `generate` submits a fresh generation).

Run one app instance against this SQLite volume: the row lock for a running submit lives in the process.

The database defaults to `data/app.sqlite`; override with `DATABASE_PATH`. Uploaded, trimmed, sample and generated files live in `assets/` next to the database (`data/assets/<sha256>.<ext>`), one row each in the `assets` table.

The app opens one SQLite connection per process (WAL, `busy_timeout` 5000 ms, foreign keys on). When the server first loads its database module, it applies each `src/server/migrations/NNN-name.sql` not yet recorded in the `migrations` table, each in its own transaction. Add a schema change as the next numbered file; never edit an applied one. The production image copies the directory next to `.output`.

Right after the migrations, in one transaction, it seeds the samples, each upserted by slug: the characters of `samples/characters/manifest.json` (`is_sample = 1`, `origin = 'generated'`) with their PNGs stored as `sample` assets, and the motions of `samples/motions/manifest.json` (the `motions` table, with license and attribution) with their clips stored as `sample` video assets. A motion's manifest entry carries what ffprobe reads from its clip (`tests/samples.test.ts` checks it), so seeding needs no FFmpeg. So a fresh clone, a test database or a new Railway volume has the samples before its first query, and a changed manifest reaches existing databases on the next start; seeding again changes nothing. `node scripts/seed-samples.mjs` opens the database the same way and prints the counts. The production image copies `samples/`. The three character PNGs are placeholder gradients made with FFmpeg's `gradients` source; Klein-generated samples replace them later. The one sample motion, `street-dance.mp4`, is the template's driving clip (`fixtures/wan/driving.mp4`, `street_dance_drive.mp4` from the MIT-licensed [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates/tree/7d8ed32f0bf6b8d52129976535422d6f518fe463)); the licensed motion library replaces it in Step 9.1.

## Uploads and video routes

`POST /api/uploads` streams one multipart video (field `file`) through Busboy to a hidden temporary file in the assets directory, hashing it with SHA-256 on the way. The file limit is 128 MiB, with 64 KiB additional multipart overhead; a request that declares more gets 413 before anything is written. Interrupted and rejected uploads remove partial files.

`ffprobe` then decides what the file is; the filename and declared type are ignored. MP4, QuickTime and WebM files with a video stream of at least 3 s are accepted; anything else is a 422 with `reason` `no_video` or `too_short`, and leaves no file and no row. An accepted file moves to `<sha256>.<ext>` and gets an `assets` row (`role: upload`, with width and height as displayed, duration, frame rate and `has_audio`). The same bytes uploaded again return the stored row with 200 instead of 201.

A clip over 8 s is kept whole, and the response's `trimmed` field carries its first 8 s as a `trimmed` asset (video and audio, `source_asset_id` pointing at the upload). `POST /api/assets/:id/trim` with `{ "start_ms", "duration_ms" }` (3–8 s) cuts another range. A cut that starts on a keyframe is a stream copy; any other cut is re-encoded to H.264 and AAC. Either way the audio stays in sync, and the same cut returns the stored asset. The response contracts are documented in `src/lib/contracts.ts`.

`POST /api/characters` takes an image (field `image`) and `consent=true`, the uploader's statement that they may use the likeness. Without consent it returns 422 `consent_required`, and a file that `ffprobe` does not read as PNG, JPEG or WebP returns 422 `not_image`; neither stores anything. Otherwise the image becomes an asset and a character with `origin: upload` and `consent_at` set. The same image returns the same character.

On Node, uploads read the underlying HTTP stream directly with byte-based backpressure. This avoids the extra buffer copies from converting the incoming Node stream to a Web stream and back. Standard Web requests use the streaming fallback. HTTP tests cover both oversized chunked uploads returning 413 and disconnect cleanup.

`GET` and `HEAD /media/<asset id>.<ext>` serve a stored asset (an upload, a cut, a sample image, a result or its poster) with its MIME type, single byte ranges, suffix ranges, 206, and unsatisfiable-range 416 responses. The extension must match the stored file; anything else is a 404. In `npm run dev`, Nitro would hand `<video>` and `<img>` requests to Vite's static files; a dev-only plugin in `vite.config.ts` keeps `/media/*` on the app.

## Verify

```sh
npm run check
npm run check:privacy
npm run test:server
npm run build
npm run check:client
```

Run the browser tests (export `APP_ACCESS_CODE` to test with the access gate on):

```sh
npx playwright install chromium
npm run test:e2e
```

Playwright starts its own dev server and never reuses a running one. It listens on `BASE_URL` (default `http://127.0.0.1:3032`; the port must be free), points Comfy at a dead port (`COMFY_BASE_URL=http://127.0.0.1:1`), so no test can submit a paid job, and uses a new database: `E2E_DATABASE_PATH`, by default a fresh temporary directory. `tests/e2e/seed.ts` refuses a database file that already exists, so the tests never read or change `data/app.sqlite`. It adds one `done` generation of the sample motion, its result and poster stored from `tests/fixtures/result-5s.mp4` (5 s, H.264 and AAC) and `tests/fixtures/result-poster.jpg`; seeding needs FFmpeg's `ffprobe`.

Check upload memory in a dedicated container, using the native image built above (for Colima, use `--context colima` and set `SPIKE_DOCKER_CONTEXT=colima`):

```sh
docker run -d --name open-photon-memory --init \
  -e ENABLE_DEBUG=1 -p 127.0.0.1:3031:3000 open-photon:latest
SPIKE_DOCKER_CONTEXT=default SPIKE_CONTAINER=open-photon-memory \
  BASE_URL=http://127.0.0.1:3031 node scripts/verify-upload-memory.mjs
docker rm --force --volumes open-photon-memory
```

The upload-memory script requires an explicit container and HTTP address, restarts that container, and runs six transfers without Comfy credentials. It retains the 64 MiB limits for anonymous-memory growth, application RSS growth, and sampled array-buffer peaks; failures return a nonzero exit code. The report in `work/upload-memory.json` includes the image and Docker host architecture. Measurements depend on the container environment and sampling interval. Historical simulation and detailed measurement records are private; simulated jobs are not evidence of real generation.

`tests/app.spec.ts` covers the access gate in a browser and the generation routes' answers to malformed and unknown ids; `tests/motion.spec.ts` the motion step (sample previews, the trim dialog for a 12 s clip, too short and no video, an unknown id in the URL); `tests/character.spec.ts` the character step (both ids in the URL across a reload, the consent checkbox gating an upload, a non-image refused inline, an unknown id); `tests/generate.spec.ts` the generate step (an invalid form fires no server-function `POST`, a dead-port generation shows `failed` with the reason and Retry opens its failed child, an unknown id is a 404 page); `tests/compare.spec.ts` the compare player on the seeded result (both videos playing within 500 ms of Play, the source within 0.1 s of a seek of the result, the scrubber, the end and Replay, `206` responses for both videos, only the result unmuted, the swipe slider on a 390 px screen). `tests/e2e/sign-in.setup.ts` signs in once per run and shares the session (`/access` allows 10 attempts a minute). No browser test submits a paid job.

## Railway staging

The deployment test app is private. Railway builds the repository's Dockerfile in the `open-photon` project, `staging` environment. It runs one replica in Europe with a 1 CPU / 1 GB RAM limit and a 5 GB volume mounted at `/app/data`. Keep one replica while SQLite and output collection use local storage.

Runtime variables are `PORT=3000`, `HOST=0.0.0.0`, `DATABASE_PATH=/app/data/app.sqlite`, `COMFY_BASE_URL=https://cloud.comfy.org`, and `PUBLIC_APP_URL` (the deployment origin). Set `COMFY_API_KEY` as a service secret; leave `ENABLE_DEBUG` unset.

Upgrading from the spike: the old `spike.sqlite` and the spike's `data/media/` and `data/renders/` are abandoned (nothing in them carries over; migration 003 drops the spike `renders` table) and can be deleted. `DATABASE_PATH` must be `/app/data/app.sqlite` or unset.

Railway mounts volumes as root. `RAILWAY_RUN_UID=0` starts the entrypoint as root so it can create and assign the database directory to `node`, then `gosu` replaces it with the app running as UID 1000. Ordinary Docker runs still default to `USER node`. Existing files must already be writable by `node`; startup does not recursively change ownership of stored assets.

Railway service settings select the Dockerfile builder, check `/healthz` with a 120-second health-check timeout, and restart on failure up to three times. The volume and runtime secrets also remain Railway configuration. We do not use the deprecated `railway.toml` format. The Dockerfile intentionally has no `VOLUME` instruction because Railway rejects it; local runs must explicitly mount storage as shown above.

## Continuous integration and deployment

[CI](.github/workflows/ci.yml) runs on every `main` push and pull request, and can be started manually. It installs from the lockfile, checks types, lint, formatting, unused code and duplication, checks private paths across Git history, runs server tests and the browser tests (with an access code), builds the Linux AMD64 image (including its client-secret scan), and runs the six-upload memory check on the native x86 runner. The container starts with a fresh root-owned volume, and CI checks that the app runs as UID 1000 and can write SQLite on that volume. CI uses no Comfy secrets and submits no paid jobs.

Railway follows `main` with **Wait for CI** enabled. Each push must pass GitHub Actions before Railway builds and deploys the Dockerfile; failed checks block that deployment. Main-branch CI runs are not canceled by newer pushes. Pull-request checks do not deploy to staging. A successful Railway deployment must pass the HTTP health check before becoming active.

`npm run check:privacy` requires a full Git checkout. It rejects tracked private paths and their historical document locations. Local notes belong in `docs/priv/`, which is excluded from both Git and the Docker context. An ignore rule cannot remove files already committed; run the privacy check before the first push as well as in CI.

## SDK and secrets

The SDK runs only in server modules. Vite externalizes it; Nitro traces the package into production output. `.env*` is excluded from Git and the Docker context. Every image build uses a dummy key and scans `.output/public` for credential configuration names and the canary value.

With `ENABLE_DEBUG=1`, `GET /api/debug/streams` reports the event-stream counters (`active`, opened, completed, request aborts, cancellations) and the process memory; without it the route is a 404. Leave it unset outside diagnostics.

The Vite/Nitro build still emits upstream `use client` warnings.

## Private preview access

Set `APP_ACCESS_CODE` to a random secret of 24–256 characters (for example, `openssl rand -hex 24`). Production fails closed when it is missing or invalid. Local development without the variable remains open. Supply it in `.env` for Docker and export it when running verification scripts or browser tests. Never commit the code.

Every dynamic page, API, server function, upload, event stream, and media request requires an access session. `/access` accepts the code and sets a signed, HttpOnly, SameSite cookie for 12 hours; HTTPS deployments also set Secure. Changing the code and redeploying invalidates existing sessions. Login attempts are limited to 10 per minute across this single instance. `/healthz` is public and reports readiness without touching Comfy. Static application assets remain public and contain no credentials.

This is a shared preview gate: anyone with the code can spend Comfy credits. It does not impose per-user spending limits. Protected pages and media are private, so public social-preview crawlers cannot access them. The deployment URL previously appeared in this README; removing it does not erase Git history or make it secret.
