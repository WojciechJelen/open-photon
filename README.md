# Comfy Start spike

TanStack Start v1 with typed routes, SQLite server functions, resumable simulated jobs, streaming uploads, video byte ranges, and server-rendered share metadata.

Start is pinned to `1.169.3`. The registry does not publish an exact `1.0.0` version. Tailwind 4 and shadcn components are installed. The server uses Node's built-in SQLite module.

## Run

```sh
docker build --platform linux/amd64 -t comfy-start-spike:latest .
docker run -d --name comfy-start-spike --platform linux/amd64 --init \
  -e ENABLE_SPIKE_CHECKS=1 \
  -p 127.0.0.1:3030:3000 \
  --mount type=volume,source=comfy-start-spike-data,target=/app/data \
  comfy-start-spike:latest
```

Open <http://localhost:3030>. Create a job, reload while it runs, or open <http://localhost:3030/r/test> to try video seeking and sharing. If Docker runs in Colima, insert `--context colima` after `docker`.

`docker compose up --build -d` is an alternative launch method. Use one method at a time because both bind port 3030. The image includes Node 24 and FFmpeg and runs as the `node` user. Keep the named volume to retain SQLite and uploaded media.

For local development, use Node 24+, `npm ci`, then `npm run dev`.

## Verify

```sh
npm run check
npm run typecheck
npm run test:server
npm run build
npm run check:client
node scripts/verify-video.mjs
node scripts/verify-sdk.mjs
node scripts/verify-upload-memory.mjs
```

The video verification command targets a running container named `comfy-start-spike`, uses the `colima` Docker context, and intentionally kills and restarts that container at 50% progress. It also uploads 100 MiB, measures cgroup memory, and checks declared and chunked upload limits. Set `SPIKE_CONTAINER`, `SPIKE_DOCKER_CONTEXT`, and `BASE_URL` to use another dedicated test instance. It writes `work/video-checks.json` and removes its large upload fixtures after verification.

The upload-memory command runs six 100 MiB uploads, with fresh and reused server processes and throttled and unthrottled transfers. It restarts the dedicated test container and records cgroup categories, application memory, process RSS, and health-check timestamps in `work/upload-memory.json`, including failed runs. It uses the same container and context overrides as the video command and removes its upload fixtures. The 64 MiB ceiling now applies to anonymous-memory growth, application RSS growth, and the array-buffer peak. The original working-set result is retained alongside them, since that calculation includes active file cache. Readiness loads the home page before measuring uploads, matching the original video verification. On Apple Silicon, use the native ARM control described in `docs/upload-memory-recheck.md` for an application RSS benchmark; an amd64 process includes QEMU overhead.

The browser cases are also captured in `tests/studio.spec.ts`. With Playwright Chromium installed and a server running, use `npm run test:e2e`. The recorded verification in `docs/video-readiness.md` distinguishes automated server checks from browser checks.

## Video and job behavior

- `POST /api/uploads` accepts one multipart `file` with an MP4 filename, streams it through Busboy to disk, then renames the completed file. Files are limited to 128 MiB, with a further 64 KiB allowance for multipart request overhead. It does not call `request.formData()` or buffer the whole file. Interrupted and rejected uploads remove their partial files.
- `GET` and `HEAD /media/:filename` support single byte ranges, suffix ranges, `206`, and unsatisfiable-range `416` responses. The bundled `x.mp4` and `x.jpg` are test fixtures.
- `POST` server function `createJob` persists start time and duration. The URL includes the job ID, and the route loader reads it back from SQLite after reload.
- `GET /api/jobs/:jobId` and the SSE route atomically finalize elapsed fake jobs on read. This makes the deterministic simulation recover after a server kill without a background queue. A real Comfy job must persist the provider job ID and reconcile the provider's actual status and outputs. Elapsed time cannot establish real generation success.
- SSE subscriptions stop on request abort or consumer cancellation. Responses include `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`.
- `/r/test` and `/r/:jobId` emit Open Graph tags in raw SSR HTML. Set `PUBLIC_APP_URL` for absolute share URLs outside localhost.

SQLite and uploads default to `data/spike.sqlite` and `data/media`. Override them with `DATABASE_PATH` and `MEDIA_DIRECTORY`. The fake duration defaults to ten seconds and accepts `FAKE_JOB_DURATION_MS` at runtime.

## SDK and credentials

`@comfyorg/sdk` is imported only by `src/server/comfy.server.ts`. Vite keeps the SDK external in the server build, and Nitro traces and includes the SDK and its dependencies in the deployable output. `/api/spike/comfy` checks a deliberately nonexistent job. `/api/spike/status` exposes subscription counters and memory, and `/api/spike/jobs` creates verification jobs. These diagnostic routes require `ENABLE_SPIKE_CHECKS=1`; leave it unset when they are not needed.

For a live authentication check, put `COMFY_API_KEY=...` in the ignored `.env` file and supply it only at runtime with `docker run --env-file .env ...`. Never pass the real key as a build argument. `COMFY_BASE_URL` can target a self-hosted deployment instead.

`scripts/mock-comfy.mjs` is a local fixture that accepts a fixed dummy authorization header and responds with a 404 error envelope. `node scripts/verify-sdk.mjs` creates temporary isolated app and mock containers, verifies the typed `NotFound` error and runtime authorization header, then removes them. It uses port 3031 and the same Docker context settings as the video check. This proves production packaging and runtime header plumbing, but does not prove a real Comfy credential works.

Every Docker build uses a dummy credential and scans `.output/public`, the actual browser output directory, for credential configuration names and that dummy value. `.env*` files are excluded from Git and the Docker context. The Vite/Nitro toolchain still emits upstream `use client` build warnings.
