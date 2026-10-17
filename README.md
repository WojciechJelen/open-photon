# Comfy Start spike

A small TanStack Start v1 app proving typed search parameters, a SQLite mutation through a server function, and incremental SSE in a production Docker container.

Start is pinned to `1.169.3`. The registry does not publish an exact `1.0.0` version. Tailwind 4 and the shadcn Button, Input, and Progress components are installed.

## Run with Docker

```sh
docker build -t comfy-start-spike:latest .
docker run -d --name comfy-start-spike --init \
  -p 127.0.0.1:3030:3000 \
  --mount type=volume,source=comfy-start-spike-data,target=/app/data \
  comfy-start-spike:latest
```

Open <http://localhost:3030>. Follow **Open the studio**, enter a prompt, and select **Create job**. The returned SQLite row appears immediately; the simulated render advances to 100% over three seconds.

Alternatively, `docker compose up --build -d` manages the container and a persistent SQLite volume. Use one launch method at a time because both bind port 3030. If Docker runs through Colima, insert `--context colima` after `docker`; the commands above otherwise use your current Docker context.

The container runs as the unprivileged `node` user. SQLite lives at `/app/data/spike.sqlite` and survives container removal when you retain the named volume.

## Develop

Requires Node 24 or newer. SQLite uses Node's built-in `node:sqlite` module, so no native database package needs compilation. Node may emit its experimental SQLite warning.

```sh
npm ci
npm run dev
```

The development URL is <http://localhost:3030>. Set `DATABASE_PATH` to override the default `data/spike.sqlite`. To run the production build outside Docker:

```sh
npm run build
PORT=3030 npm start
```

## Verify

```sh
npm run check
npm run typecheck
npm run test:server
npx playwright install chromium
npm run test:e2e
```

Browser tests expect an already running app at `http://127.0.0.1:3030`. Override it with `BASE_URL`. They exercise the real server function and SSE route without mocking the database or network. Tests create small job rows in the target instance.

`tests/type-contracts.ts` checks inferred server-function output and verifies that an unsupported preset fails compilation. The stream tests cover incremental completion, request abort, pre-aborted requests, and consumer cancellation.

The Vite/Nitro build can report third-party `use client` directive warnings. This spike uses regular SSR and client hydration, not React Server Components.

## Where the five checks live

| Check | File |
| --- | --- |
| Typed Link into `/studio` | `src/routes/index.tsx` |
| `validateSearch` and typed client state | `src/routes/studio.tsx` |
| POST server function | `src/lib/jobs.functions.ts` |
| SQLite insert with `RETURNING` | `src/server/db.server.ts` |
| GET `/api/jobs/:jobId/events` | `src/routes/api.jobs.$jobId.events.ts` |
| Fake job and stream cleanup | `src/server/fake-job.server.ts` |
| Browser `EventSource` client | `src/components/job-progress.tsx` |
| Production image and persistent volume | `Dockerfile`, `compose.yaml` |

The job row persists. Progress is deliberately simulated per SSE connection and restarts from zero on a new connection. The client closes the connection at completion or unmount. There is no Comfy integration in this spike yet.
