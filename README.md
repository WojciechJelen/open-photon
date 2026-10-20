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

Choosing samples is open to anyone. Uploads and new generations need an access code (see "Access codes"): mint one on the app's database once it has started, `docker exec open-photon node scripts/mint-code.mjs me 20` (with `npm run dev`: `node scripts/mint-code.mjs me 20` after the first page load), and enter it when the app asks.

For local development, use Node 24+ and npm 11.6.2 (`npm install --global npm@11.6.2`), then `npm ci` and `npm run dev`. Docker and CI use the same npm version declared in `packageManager`. Install FFmpeg locally (with libx264): uploads are probed and trimmed with `ffprobe`/`ffmpeg`, the server tests run them, and generated outputs are verified with them.

## Credits

Credits per 5 s 480×848 render (distilled: lightx2v LoRA, 6 steps, int8 model): **≈17.5 credits** ($0.083 at 211 credits per dollar), for 64.9 s of GPU execution. Measured on 2026-10-19 from the workspace balance (`GET https://cloud.comfy.org/api/billing/usage/timeseries`, `summary.balance`) before and after one job, and again (≈17.7 credits) for the Step 4.1 generation; the base variant is not measured yet.

## Generating

`POST /api/generate` (JSON body `generateInputSchema` in `src/lib/contracts.ts`; `src/server/generate.ts`) takes a stored 3–8 s video asset (`motion_asset_id`: a sample motion's clip, an upload or a cut), a character (`character_id`), and optionally a prompt, a seed and an angle. **It submits a real GPU job and uses Comfy credits.** It answers 201 `{ id, reused: false }` for a submitted generation, 200 `{ id, reused: true }` for an existing one, 400 for a malformed body, and `{ error, reason }` with the status of a refusal: 404 for a missing clip or character, 422 for a clip that is unprobed or longer than 8 s or an uploaded character without consent, 401 `access_required` and 403 `code_exhausted` (see "Access codes"), 429 `rate_limited` and 503 `queue_full` (with `retry_after` and `Retry-After`; see "Rate limits and the in-flight cap"). Then, in this order:

1. It builds the recipe (workflow id, version and SHA-256, the parameters, the SHA-256 of both input files, the target) and its `recipe_hash`. If a generation with that hash is done, or still on its way, it returns that generation's id with `reused: true` and submits nothing. Without an access session it returns only a done pre-rendered sample generation (`is_prerendered`); anything else is a 401.
2. It takes a token from the generate rate limit and checks the in-flight cap; then it inserts a `preparing` row with a fresh idempotency key and the session's access code (`access_code_id`), which counts it.
3. It uploads both files to Comfy (content-addressed) and stores their references in `provider_inputs`.
4. It builds the graph with `buildGraph` and submits it with the row's idempotency key.
5. It stores the Comfy job id the moment `submit()` returns, and the row becomes `queued`.

The portrait size is 480×848 (848×480 for a landscape clip), `fragment_length` 81, the seed random unless given, the prompt the workflow's own unless given. An `angle` (`front`, `three-quarter`, `profile`; **placeholder phrasings** in `workflows/angles.json` until the angle benchmark has run) appends its phrasing to the prompt and is stored as the recipe's `angle`, so both change the `recipe_hash`; a recipe without one hashes as before. `GET /api/generations/:id` returns the generation (`generationSchema`; 400 for a malformed id, 404 for an unknown one).

The third step on `/` is the generate form: the reshoot angle ("As filmed" or a preset), an optional appearance and background description, and the seed under "Advanced". It is checked against `generateInputSchema` in the browser: an invalid form (no motion or character, a seed that is not a whole number, a description over 500 characters) says why and never calls the server. Generate opens `/g/<id>`; a reused recipe opens the same page, a done one straight to its result. That page streams the generation's events and shows only its status word and percent, never a time estimate. A failed generation shows its reason and "Retry with a new seed" (`POST /api/generations/:id/retry`, which opens the child; a child links back to its parent); an `unknown` one explains why it is not retried. Both link back to `/` with the same motion and character picked. Leaving a page cancels its uploads and trims in flight, and closing the trim dialog cancels its cut; a request the page has left never changes the selection or navigates. A refused clip or photo upload says why until another motion or character is chosen.

Without an access session, an action that needs one (an upload of a clip or a photo, a generation that is not a pre-rendered sample, a retry) shows an inline "Access code" form instead of sending anything; after the code it carries on with the same file or the same choices, on the same page. The selection in the URL, the angle, description and seed stay as they were.

A done generation shows the source clip and the result on one clock: the result is the master, the source (muted, so the result's audio plays once) follows its play, pause, seeks and stalls, and one button and one scrubber control both. Below 640 px the result lies over the source and a swipe slider uncovers it. "Download MP4" saves the result; "Same motion, another character" and "Same character, another motion" open `/` with only `?motion=` or only `?character=` set.

`GET /api/generations/:id/events` streams the generation as server-sent events (`generationEventSchema`): a snapshot of the row, then one per change Comfy reports (`running`, progress), with a `: ping` comment every 15 s so proxies keep the connection open. Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` (the access middleware leaves it on event streams) and `X-Accel-Buffering: no`. A `done`, `failed` or `unknown` generation gets one snapshot and the stream ends without a Comfy call. When Comfy cannot be asked (unreachable, timed out or an error answer) the stored snapshot has still gone first; a `provider_unavailable` event follows with the row unchanged, then the stream ends cleanly (200, never an error) with `retry:` 5 s, doubling for each failure in a row up to 60 s (counted through the event id the browser sends back as `Last-Event-ID`; a snapshot resets it), and the browser reconnects after that delay. `/g/:id` then shows the stored status as the last known one, with a notice. Closing the request aborts the SDK subscription; the job continues on Comfy. 400 for a malformed id, 404 for an unknown one.

When the event stream ends, and on every `GET /api/generations/:id` of a `queued`, `running` or `finalizing` row, `finalize` (`src/server/finalize.ts`) asks Comfy for the job (`jobs.get` is the source of truth; elapsed time never completes a job). A job that is not complete leaves the row as it is; a failed, cancelled or expired one fails it. A succeeded one is downloaded (output `246`, which already carries the driving clip's audio, so nothing is muxed), probed, hashed and stored as a `provider_output` asset, a JPEG poster is cut at 0.5 s (the first frame for a shorter output) and stored as a `poster` asset, and the row becomes `done` with `final_asset_id`, `output_asset_id` and `poster_asset_id`. One finalize per generation runs at a time in the process; concurrent callers share it. A failed download leaves the row `finalizing`, counts `finalize_attempts` and is retried on the next read. Comfy's signed output URLs last about 6 hours, so a result is re-hosted the first time anyone looks after it finished.

Opening `/g/:id` never waits for Comfy: the page renders the stored row at once, and its event stream (which ends in `finalize`) brings in a result Comfy finished while nobody was watching.

`POST /api/generations/:id/retry` retries a `failed` generation: it creates a child (`parent_id` = `:id`) with the same recipe except a fresh random seed and submits it through the same path as `generate` (201 `{ id, reused }`). **It submits a real GPU job**, so it always needs an access session. It answers 409 for a generation that is not `failed` (including `unknown`: see below), 404 for an unknown id, 400 for a malformed one, and 429 `rate_limited` or 503 `queue_full` as `generate` does (re-run too).

## Recipes and re-runs

Every generation page (and every share page) has a "Recipe" panel, collapsed until opened, that shows the stored recipe: the workflow id, version and SHA-256, the models (none recorded yet: recipes list model files with hashes and licenses once `models.lock` pins them, and it does not exist yet), every parameter (prompt, seed, size, `fragment_length`) and the reshoot angle, the SHA-256 of the motion clip and of the character image, and the target (Comfy Cloud or self-hosted ComfyUI, from `COMFY_BASE_URL`). `GET /api/generations/:id/recipe.json` returns the same recipe as JSON (`recipeSchema` in `src/server/recipe.ts`; its `workflow.sha256` is the one in `workflows/README.md`); 400 for a malformed id, 404 for an unknown one.

"Re-run recipe" (on a done or failed generation) calls `POST /api/generations/:id/rerun`: the generation's recipe again, seed included, on the target this server renders on now. It goes through the same reuse as `generate`. With the target unchanged the recipe hash is the parent's, so a done parent comes back as it is: 200 `{ id: <the parent>, reused: true }`, no new row, nothing submitted, and the page says the result is already this one. Re-running is free unless something in the recipe changed, and that answer needs no access session. A failed parent, or a parent made on the other target, gets a child (`parent_id` = `:id`, same seed) that is submitted like any generation (201): **that submits a real GPU job**, and needs a session (401 `access_required` without one). A child that kept its parent's seed says it is a re-run of the earlier generation; one with a new seed, that it is a retry. 409 when the workflow file has changed since the recipe was made, 404 for an unknown id, 400 for a malformed one.

## Share pages

A generation gets its `share_slug` when it becomes done: 16 random hex characters (64 bits; migration 005 gave one to the rows done before). Its page shows the link (`<origin>/r/<slug>`) with "Copy link" and "Open share page". `/r/:slug` is rendered on the server from the stored row: the result as a muted looping video with its poster, the source clip, the model files the recipe's workflow loads (their licenses and hashes are not pinned in this repository yet, and the page says so), and "Use this motion with my character", which opens `/?motion=<source asset id>` (open to anyone, like the picker; the access code is asked for when the visitor uploads or generates). An unknown slug is an HTTP 404.

The page's `<head>` carries Open Graph tags for link previews: `og:title`, `og:description`, `og:type` (`video.other`), `og:url`, `og:image` (the poster, with its size), `og:video` (the MP4, with `og:video:type`, `og:video:width` and `og:video:height`; `og:video:secure_url` when the URL is HTTPS) and `twitter:card` `summary_large_image` (a `player` card needs an embeddable player page, which the app does not have). Every URL in them is absolute: it starts with `PUBLIC_APP_URL` when that is set (a deployment behind a proxy must set it to its public HTTPS origin, for example `https://photon.example`), otherwise with the origin of the request, which is right for local development.

Share pages open without the access code, so social sites can read them. So do the files a share page shows: a done generation's result, its poster and its source clip, served with `Cache-Control: public`, like the sample clips and images. Every other file (uploads, cuts, character photos, unshared results) needs an access session; see "Access codes".

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

`GET` and `HEAD /media/<asset id>.<ext>` serve a stored asset (an upload, a cut, a sample image, a result or its poster) with its MIME type. The file is found by its id in the `assets` table, never by a path from the request: the extension must match the stored file, and anything else (another extension, an unknown id, `..`) is a 404. One byte range per request: `bytes=a-b`, `bytes=a-` and the suffix `bytes=-n` get 206 with `Content-Range`; a range that starts past the end (or `bytes=-0`) gets 416 with `Content-Range: bytes */<size>`; a header with several ranges, or a malformed one, is ignored and the whole file is sent with 200. Assets never change, so every answer carries `Cache-Control: max-age=31536000, immutable` and `ETag: "<sha256 of the file>"`; a matching `If-None-Match` gets 304, and `If-Range` keeps a range only while it names the same file. The cache is `public` for the files anyone may see (samples, and what a share page shows) and `private` (no shared cache may keep it) for everything behind the access code. `?download=1` adds `Content-Disposition: attachment; filename="open-photon-<first 8 characters of the asset id>.<ext>"`. In `npm run dev`, Nitro would hand `<video>` and `<img>` requests to Vite's static files; a dev-only plugin in `vite.config.ts` keeps `/media/*` on the app.

## Verify

```sh
npm run check
npm run check:privacy
npm run test:server
npm run build
npm run check:client
```

Run the browser tests:

```sh
npx playwright install chromium
npm run test:e2e
```

Playwright starts its own dev server and never reuses a running one. It listens on `BASE_URL` (default `http://127.0.0.1:3032`; the port must be free), points Comfy at a dead port (`COMFY_BASE_URL=http://127.0.0.1:1`), so no test can submit a paid job, and uses a new database: `E2E_DATABASE_PATH`, by default a fresh temporary directory. `tests/e2e/seed.ts` refuses a database file that already exists, so the tests never read or change `data/app.sqlite`. It adds one `done` generation of the sample motion, its result and poster stored from `tests/fixtures/result-5s.mp4` (5 s, H.264 and AAC) and `tests/fixtures/result-poster.jpg`, and one `queued` generation that never moves on, and mints the run's access code; seeding needs FFmpeg's `ffprobe`. The server allows two generations in flight (`IN_FLIGHT_MAX=2`, as the seeded `queued` one takes a place) and 1000 uploads and generate requests a minute, since the whole run comes from one client with one code.

Check access and upload memory in a dedicated container, using the native image built above (for Colima, use `--context colima` and set `SPIKE_DOCKER_CONTEXT=colima`). Both scripts sign in with `ACCESS_CODE`, a code minted in that container:

```sh
docker run -d --name open-photon-memory --init \
  -e ENABLE_DEBUG=1 -p 127.0.0.1:3031:3000 open-photon:latest
curl -fsS -o /dev/null http://127.0.0.1:3031/healthz   # opens and migrates its database
export ACCESS_CODE=$(docker exec open-photon-memory node scripts/mint-code.mjs memory 5)
BASE_URL=http://127.0.0.1:3031 node scripts/verify-access.mjs
SPIKE_DOCKER_CONTEXT=default SPIKE_CONTAINER=open-photon-memory \
  BASE_URL=http://127.0.0.1:3031 node scripts/verify-upload-memory.mjs
docker rm --force --volumes open-photon-memory
```

The upload-memory script requires an explicit container and HTTP address, restarts that container, and runs six transfers without Comfy credentials. It retains the 64 MiB limits for anonymous-memory growth, application RSS growth, and sampled array-buffer peaks; failures return a nonzero exit code. The report in `work/upload-memory.json` includes the image and Docker host architecture. Measurements depend on the container environment and sampling interval. Historical simulation and detailed measurement records are private; simulated jobs are not evidence of real generation.

`tests/access.spec.ts` covers the picker without a session (the samples play; choosing a clip to upload shows the inline code form before anything is sent, a wrong code is refused, the right one uploads that clip and keeps the chosen character); `tests/app.spec.ts` a generation's page opened without a session (a wrong code is refused, the right one opens the page first asked for) and the generation routes' answers to malformed and unknown ids; `tests/motion.spec.ts` the motion step (sample previews, the trim dialog for a 12 s clip, closing it during a cut, leaving the page during an upload, too short and no video, an upload over the rate limit, an unknown id in the URL); `tests/character.spec.ts` the character step (both ids in the URL across a reload, the consent checkbox gating an upload, a non-image refused inline, an unknown id); `tests/generate.spec.ts` the generate step and `/g/:id` (an invalid form sends no `POST /api/generate`, a dead-port generation shows `failed` with the reason and Retry opens its failed child, which links back to its parent and to the same choices; with both places in flight taken Generate shows `queue_full` on the form, stays on `/` and adds no generation; a running generation shows its stream's progress and opens the stream again after a reload; a finished one opens no stream; an unknown id is a 404 page); `tests/compare.spec.ts` the compare player on the seeded result (both videos playing within 500 ms of Play, the source within 0.1 s of a seek of the result, the scrubber, the end and Replay, `206` responses for both videos, only the result unmuted, the swipe slider on a 390 px screen); `tests/remix.spec.ts` the download (saved as `open-photon-<id>.mp4`) and the two remix buttons (each keeps exactly one of `motion` and `character`). The tests find controls by role and accessible name and assert states, not wording. `tests/e2e/seed.ts` mints the run's access code with `scripts/mint-code.mjs` into the scratch database, and `tests/e2e/sign-in.setup.ts` signs in with it once per run (`POST /api/session`; logins are limited to 10 a minute) and shares the session; the anonymous tests start without it. No browser test submits a paid job.

`tests/share.spec.ts` covers share pages: the raw HTML of `/r/<slug>` fetched without a session (no JavaScript) carries the Open Graph tags with absolute URLs, the video they name answers a range with 206 and the poster with 200, an unknown slug is a 404; an uploaded character photo, the generation API and `/g/:id` stay closed to a visitor without a session; in a browser without a session the result and source loop muted and "Use this motion with my character" opens `/?motion=` with the shared clip playing; `/g/:id` shows the share link and opens the page.

`tests/recipe.spec.ts` covers the recipe: `recipe.json`'s `workflow.sha256` is the workflow file's, the panel on `/g/:id` and on the share page is closed until opened and closes again, and "Re-run recipe" on the seeded done generation (seeded on the server's own target) stays on that page and adds no generation.

## Railway staging

The deployment test app is private. Railway builds the repository's Dockerfile in the `open-photon` project, `staging` environment. It runs one replica in Europe with a 1 CPU / 1 GB RAM limit and a 5 GB volume mounted at `/app/data`. Keep one replica while SQLite and output collection use local storage.

Runtime variables are `PORT=3000`, `HOST=0.0.0.0`, `DATABASE_PATH=/app/data/app.sqlite`, `COMFY_BASE_URL=https://cloud.comfy.org`, `PUBLIC_APP_URL` (the deployment's public HTTPS origin: share pages build their absolute Open Graph URLs from it), `CLIENT_IP_HEADER=X-Real-IP` (Railway's edge sets that header to the client's address; see "Rate limits and the in-flight cap") and `IN_FLIGHT_MAX` (the Comfy plan's concurrency: 1 on Standard, the default). Set `COMFY_API_KEY` as a service secret; leave `ENABLE_DEBUG` unset. Access codes live in the database on the volume, not in a variable: after a deploy is healthy, mint one in the running service (for example with `railway ssh`, then `node scripts/mint-code.mjs judges 50`).

Upgrading from the spike: the old `spike.sqlite` and the spike's `data/media/` and `data/renders/` are abandoned (nothing in them carries over; migration 003 drops the spike `renders` table) and can be deleted. `DATABASE_PATH` must be `/app/data/app.sqlite` or unset.

Railway mounts volumes as root. `RAILWAY_RUN_UID=0` starts the entrypoint as root so it can create and assign the database directory to `node`, then `gosu` replaces it with the app running as UID 1000. Ordinary Docker runs still default to `USER node`. Existing files must already be writable by `node`; startup does not recursively change ownership of stored assets.

Railway service settings select the Dockerfile builder, check `/healthz` with a 120-second health-check timeout, and restart on failure up to three times. The volume and runtime secrets also remain Railway configuration. We do not use the deprecated `railway.toml` format. The Dockerfile intentionally has no `VOLUME` instruction because Railway rejects it; local runs must explicitly mount storage as shown above.

## Continuous integration and deployment

[CI](.github/workflows/ci.yml) runs on every `main` push and pull request, and can be started manually. It installs from the lockfile, checks types, lint, formatting, unused code and duplication, checks private paths across Git history, runs server tests and the browser tests (each with codes minted into its own scratch database), builds the Linux AMD64 image (including its client-secret scan), mints a code in the container and runs the access check (`scripts/verify-access.mjs`) and the six-upload memory check on the native x86 runner. The container starts with a fresh root-owned volume, and CI checks that the app runs as UID 1000 and can write SQLite on that volume. CI uses no Comfy secrets and submits no paid jobs.

Railway follows `main` with **Wait for CI** enabled. Each push must pass GitHub Actions before Railway builds and deploys the Dockerfile; failed checks block that deployment. Main-branch CI runs are not canceled by newer pushes. Pull-request checks do not deploy to staging. A successful Railway deployment must pass the HTTP health check before becoming active.

`npm run check:privacy` requires a full Git checkout. It rejects tracked private paths and their historical document locations. Local notes belong in `docs/priv/`, which is excluded from both Git and the Docker context. An ignore rule cannot remove files already committed; run the privacy check before the first push as well as in CI.

## SDK and secrets

The SDK runs only in server modules. Vite externalizes it; Nitro traces the package into production output. `.env*` is excluded from Git and the Docker context. Every image build uses a dummy key and scans `.output/public` for credential configuration names and the canary value.

With `ENABLE_DEBUG=1`, `GET /api/debug/streams` reports the event-stream counters (`active`, opened, completed, request aborts, cancellations) and the process memory; without it the route is a 404. Leave it unset outside diagnostics.

The Vite/Nitro build still emits upstream `use client` warnings.

## Access codes

Uploads and generation need an access code; choosing samples does not. Codes live in the `access_codes` table (migration 006): a label, the most generations the code may start (`max_generations`), how many it has (`used`), and the SHA-256 of the code, never the code itself. Mint one on the database the app uses (it must have started once, so the database exists and is migrated):

```sh
node scripts/mint-code.mjs <label> <max generations>                    # local: DATABASE_PATH or data/app.sqlite
docker exec open-photon node scripts/mint-code.mjs judges 50            # the Docker container's volume
```

It prints a fresh 24-character code (144 random bits) once. A lost code cannot be shown again: mint another. Revoke one with `sqlite3 <database> "UPDATE access_codes SET revoked_at = datetime() WHERE label = '<label>'"`; its sessions end at once.

`POST /api/session` with `{ "code": "…" }` answers 204 and sets the session cookie, or 401 `invalid_code`; `/access` is the same exchange as a plain HTML form, for a page opened without a session, and returns to its `next` parameter when that is a path on this site, else to `/`. Logins (both kinds) are limited to 10 a minute across the instance, then 429 with `Retry-After`. The cookie (`photon_access`) is HttpOnly, `SameSite=Lax`, `Secure` in production and on HTTPS, and lasts 12 hours. It holds the code's id, its expiry and an HMAC of both keyed with the code's stored hash: no server secret is needed, sessions survive restarts, and revoking the code ends them.

Open without a session: the picker (`/` and its data, including the sample clips and images), share pages (`/r/<slug>`) and the media they show, `/healthz`, static assets, and the page and API of a pre-rendered sample generation (`is_prerendered = 1`, the sample × sample matrix). `POST /api/generate` and `POST /api/generations/:id/rerun` are reachable too, but only answer with a result that already exists (a done pre-rendered sample, or a done generation's own result); anything that would render is a 401 `access_required`. Everything else needs a session: uploads, cuts, character photos, `POST /api/generations/:id/retry`, and the page, API, event stream and recipe of every other generation. A page opened without one redirects to `/access?next=<that page>`; an API answers 401 `{ error, reason: "access_required" }`, on which the app shows its inline code form. The guard is the global request middleware (`src/start.ts`, `src/server/access.server.ts`, the list in `src/server/public-access.ts`); server functions pass it and check access themselves. The list matches paths the way the router does (fixed parts in any letter case, one trailing slash or none), so an alias of a public URL is public and an alias of any other URL is not. A picker link that names an upload keeps it without a session: the page says the clip or photo is the visitor's own and offers the code form to show it, and Generate sends it as it is and asks for the code then.

Each generation records the code that started it (`access_code_id`). `used` counts a generation from the moment its row is stored, and gives the count back if it fails before Comfy took it (`preparing → failed`: an upload or submit Comfy refused or never received, or a server stopped before sending it); a generation Comfy accepted, or may have (`unknown`), stays counted, and a reused result never counts. So with Comfy unreachable nothing is used up. When `used` reaches `max_generations`, `generate`, retry and re-run refuse anything that would render with 403 `code_exhausted`.

This is a shared preview gate: anyone with a code can spend Comfy credits up to its maximum. Protected pages and media are private; share pages, their media and the samples are public. The deployment URL previously appeared in this README; removing it does not erase Git history or make it secret.

## Rate limits and the in-flight cap

A public link must not drain the credits, so two more checks stand in front of Comfy (`src/server/limits.ts`):

- **Rate limits**: token buckets in memory, one per client and one per access code. Uploads, cuts and character photos (`POST /api/uploads`, `/api/assets/:id/trim`, `/api/characters`) take a token from both before the body is read, `UPLOAD_RATE_LIMIT` a minute (default 10); their route handlers take it (`uploadRefusal`), so every URL the router sends to them counts, in any letter case or with a trailing slash. `POST /api/generate`, `…/retry` and `…/rerun` take one from both for every answer except an existing result, refusals included (a malformed body, a missing clip, no code), `GENERATE_RATE_LIMIT` a minute (default 3). A reused result (a pre-rendered sample, a re-run of a done generation, a recipe already done or on its way) never takes one and is never refused; one found only after waiting for a full cap (another request started that recipe meanwhile) gives its token back. Each bucket holds its limit and refills at that rate; an empty one is a 429 `{ error, reason: "rate_limited", retry_after }` with `Retry-After` in seconds, and no row is created. The buckets live in this one process (they restart empty) and at most 10,000 are kept, idle ones dropped first.
- **In-flight cap**: at most `IN_FLIGHT_MAX` generations (default 1, Comfy Cloud Standard's one concurrent workflow; 0 refuses every new one) may be `preparing`, `queued`, `running` or `finalizing` at once, counted from the database (`unknown` ones are not). When a new generation finds it full, the five oldest of those rows are brought up to date first, as `GET /api/generations/:id` does (a row a stopped server left `preparing` is settled, a job Comfy finished or failed is finalized), waiting at most 5 s for Comfy, so a generation nobody watches any more does not hold its place. If it is still full the answer is a 503 `{ error, reason: "queue_full", retry_after: 30 }` with `Retry-After`, and no row is created. A reused result is returned whatever the cap.

The client is the address in the `CLIENT_IP_HEADER` request header when that is set, which must be a header the proxy in front of the app sets itself (on Railway, `X-Real-IP`); when it is unset the connection's own address is used and `X-Forwarded-For` and the like are ignored, since any client can send them. Only a SHA-256 of the address is kept. The generate form shows a refusal under the button ("Queue full", "Too many generation requests", with the wait), the clip upload shows "Slow down" with the wait, and the photo upload, the trim dialog, Retry and Re-run show the server's message.
