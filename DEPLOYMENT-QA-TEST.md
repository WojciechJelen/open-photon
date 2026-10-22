# Deployment QA test plan

Historical test plan and results for the pre-release configuration (2026-10-22).
Its overloaded `COMFY_API_KEY` and REST v1 template examples describe that version.
For current deployment instructions use [SETUP.md](SETUP.md); the release verification
is recorded separately in [docs/deployment-verification.md](docs/deployment-verification.md).

A step-by-step plan to test Open Photon's deployment configuration on both targets: Comfy Cloud and a self-hosted ComfyUI behind `comfy-api-proxy` on RunPod. Run the phases in order. Record every result in the [results table](#results-table) and finish with the [teardown checklist](#teardown-checklist).

## Purpose and scope

Covered:

- Static checks of the code, model pins, open-weights gate, Compose file and both Dockerfiles.
- The server's startup check of `COMFY_BASE_URL` and `COMFY_API_KEY` (`src/shared/server/comfy-target.ts`, `src/shared/server/comfy-boot.ts`).
- `npm run check:comfy` (`scripts/check-comfy.mjs`) against a local stub, Comfy Cloud and the pod.
- One real render on Comfy Cloud through the UI, with download, share page and the in-flight cap.
- The GPU image (`selfhost/`): build, RunPod template and pod boot, preflight failures, the proxy's auth.
- The app against the pod: a render recorded and checked with `scripts/verify-selfhost.mjs`, RunPod's 100 s stream cut, upload limits, a wrong token.
- Switching between targets and what it does to recipes.

Not covered:

- Feature behavior beyond one render per target (the wizard, recipes and share pages have their own tests: `npm run test:e2e`).
- Railway staging and CI (README "Railway staging", "Continuous integration and deployment").
- Upload memory (`scripts/verify-upload-memory.mjs`, README "Verify").
- Any GPU other than the documented one (RTX 5090, 32 GB), resolutions other than 480×848, the non-LoRA base variant.
- The SSH-tunnel transport (`PROXY_HOST=127.0.0.1`, docs/selfhost.md "Loopback alternative") and TCP-port exposure.
- Load: more than one render in flight on the pod, or more than 8 SSE streams per proxy.

Tags: `[COST]` spends Comfy credits or RunPod money. `[GPU]` needs the RunPod GPU pod running.

## Preconditions

Accounts and keys:

- Comfy Cloud: an API key whose account has workflow-generation access and credits. One Cloud render costs ≈17.5 credits (README "Credits"); this plan renders once on Cloud ([C-06](#c-06-one-real-render-through-the-ui-cost)).
- RunPod: an account with balance, `RUNPOD_API_KEY` exported, a data center with RTX 5090 stock (`runpodctl gpu list`).
- A container registry RunPod can pull from (`<registry>`), logged in with `docker login`.

RunPod budget: the pod bills per second from creation to deletion, and the network volume bills until it is deleted, whether or not a pod runs. This plan keeps one GPU pod up from [S-05](#s-05-network-volume-pod-and-first-boot-gpu-cost) to [T-01](#t-01-stop-the-pod-cost), with two renders on it ([P-03](#p-03-render-record-vram-and-verify-gpu-cost), [P-05](#p-05-a-100128-mib-clip-reaches-comfyui-gpu-cost)). Check the hourly price with `runpodctl gpu list` before S-05. The first boot downloads about 26 GB of weights and every boot re-hashes them (SETUP.md "Sizing"); neither duration is measured. The proof render took 158.717 s from submission to done (README).

Tools on the operator machine:

| Tool | Check |
| --- | --- |
| Node 24+, npm 11.6.2 | `node --version`, `npm --version`; then `npm ci` in the repository root |
| Docker with Compose and BuildKit checks | `docker compose version`, `docker build --check --help` |
| `runpodctl` (latest) | `runpodctl update && runpodctl version` |
| `jq`, `curl`, `openssl` | `jq --version`, `curl --version` |
| FFmpeg with `ffprobe` and libx264 | `ffmpeg -version`, `ffprobe -version` (also needed by `verify-selfhost.mjs`) |
| Chromium-based browser with DevTools | for the UI cases; Network tab "Preserve log" on |

Test inputs (prepare once, keep for the whole run):

- `work/qa/qa-motion.mp4`: a 3–8 s clip of a person moving, **with an audio stream** (`verify-selfhost.mjs` rejects an output without audio: "Use a driving clip with audio for the proof"). Check:

  ```sh
  ffprobe -v error -show_entries stream=codec_type -of csv=p=0 work/qa/qa-motion.mp4   # lists video and audio
  ffprobe -v error -show_entries format=duration -of csv=p=0 work/qa/qa-motion.mp4    # between 3 and 8
  ```

- One sample character (pick the same one every time) and one fixed seed `<seed>` entered under "Advanced". A non-default seed keeps the recipe from matching any pre-rendered sample, so the render is real.

Evidence directory: `work/` is ignored by Git and by the Docker context.

```sh
export QA=work/qa/$(date -u +%F)
mkdir -p "$QA"
```

Session cookie helper, used by several cases once an access code exists (`POST /api/session` answers 204 and sets `photon_access`, README "Access codes"):

```sh
export ACCESS_CODE=<the minted code>
COOKIE=$(curl -sS -D - -o /dev/null -H 'Content-Type: application/json' \
  -d "{\"code\":\"$ACCESS_CODE\"}" http://localhost:3030/api/session |
  awk 'tolower($1) == "set-cookie:" { split($2, a, ";"); print a[1] }')
echo "$COOKIE"   # photon_access=…
```

## Phase 0: static checks (no network to Comfy, no cost)

### ST-01 `npm run check`

- Precondition: `npm ci` done.
- Steps: `npm run check > "$QA/ST-01.log" 2>&1; echo "exit=$?" | tee -a "$QA/ST-01.log"`
- Expected: `exit=0` (typecheck, lint, format check, fallow in parallel; AGENTS.md "Toolchain").
- Evidence: `$QA/ST-01.log`.
- Cleanup: none.

### ST-02 `npm run test:server`

- Precondition: FFmpeg installed (the tests run `ffprobe`/`ffmpeg`).
- Steps: `npm run test:server > "$QA/ST-02.log" 2>&1; echo "exit=$?" | tee -a "$QA/ST-02.log"`
- Expected: `exit=0`; the node:test summary reports `fail 0`. `tests/comfy-target.test.ts` is among the files run.
- Evidence: `$QA/ST-02.log`.
- Cleanup: none.

### ST-03 `npm run check:models`

- Steps: `npm run -s check:models 2>&1 | tee "$QA/ST-03.log"`
- Expected, one line per runtime workflow (today one), then the cross-feature summary:

  ```text
  motionTransfer/motion-transfer.v1: 5 model files, 5 locked, 0 missing
  5 distinct model files across 1 feature lock, 0 conflicts
  ```

  Exit 0. Source: `scripts/check-models-lock.mjs`. The summary line prints only when every workflow passed; a `directory/file` pinned differently by two features prints `Conflicting pins for <directory>/<file>: <featureA> and <featureB>` to stderr and exits 1.
- Evidence: `$QA/ST-03.log`.
- Cleanup: none.

### ST-04 `npm run check:open-weights` and its negative control

- Steps:

  ```sh
  npm run -s check:open-weights 2>&1 | tee "$QA/ST-04.log"
  node scripts/check-open-weights.mjs tests/fixtures/partner-node.json >> "$QA/ST-04.log" 2>&1; echo "exit=$?" | tee -a "$QA/ST-04.log"
  ```

- Expected: first command `<n> nodes scanned in <m> JSON files, 0 forbidden`, exit 0. Second command `tests/fixtures/partner-node.json $.1: HiggsfieldGenjutsuMotionTransfer is forbidden (partner/API node)`, then `1 nodes scanned in 1 JSON files, 1 forbidden`, `exit=1`. Source: `scripts/check-open-weights.mjs`.
- Evidence: `$QA/ST-04.log`.
- Cleanup: none.

### ST-05 Compose services

- Steps: `docker compose config --services | tee "$QA/ST-05.log"`
- Expected: exactly one line, `app`. The GPU side is never part of Compose.
- Evidence: `$QA/ST-05.log`.
- Cleanup: none.

### ST-06 Dockerfile checks

- Steps:

  ```sh
  docker build --check . 2>&1 | tee "$QA/ST-06-app.log"
  docker build --check -f selfhost/Dockerfile . 2>&1 | tee "$QA/ST-06-selfhost.log"
  ```

- Expected: both end with Docker's `Check complete, no warnings found.` (Docker's own message, observed for `selfhost/Dockerfile` on 2026-10-22). Exit 0.
- Evidence: both logs.
- Cleanup: none.

### ST-07 Browser tests (optional, free)

- Precondition: `npx playwright install chromium`; port 3032 free.
- Steps: `npm run test:e2e > "$QA/ST-07.log" 2>&1; echo "exit=$?" | tee -a "$QA/ST-07.log"`
- Expected: `exit=0`. Playwright points Comfy at `http://127.0.0.1:1` (`playwright.config.ts`), so nothing is submitted.
- Evidence: `$QA/ST-07.log`, `test-results/` on failure.
- Cleanup: none.

## Phase 1: startup config matrix (no network to Comfy, no cost)

The server resolves the target in a Nitro plugin before it listens (`src/shared/server/comfy-boot.ts`, registered in `vite.config.ts`). A valid config logs one JSON line on stdout:

```text
{"auth":"bearer|none","base":"<base URL, trailing slashes stripped>","event":"comfy.target","target":"cloud|selfhost"}
```

Key order is fixed by the source (`auth`, `base`, `event`, `target`). The key is never logged. An invalid config throws: the process prints the error to stderr and exits 1 without listening.

Setup for every row:

```sh
npm run build > "$QA/CF-build.log" 2>&1; echo "exit=$?"    # exit=0; rebuild whenever src/ changed
boot() { env -i PATH="$PATH" HOME="$HOME" PORT=3099 DATABASE_PATH="$(mktemp -d)/app.sqlite" "$@" node .output/server/index.mjs; }
```

`env -i` keeps your shell's and `.env`'s variables out. For a booting row, check it listens from a second terminal, then stop it with Ctrl+C:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3099/healthz   # 200
```

For an exiting row, run `echo "exit=$?"` right after it returns, and the same `curl` must fail with `curl: (7)` (nothing listening).

A stale `.output` prints `comfy target=… base=… auth=…` as plain text instead of the JSON line; rebuild.

| ID | Environment (after `boot`) | Expected | Source |
| --- | --- | --- | --- |
| CF-01 | (nothing) | stderr has `Error: COMFY_API_KEY is not set. Comfy Cloud (https://cloud.comfy.org, used while COMFY_BASE_URL is unset) requires an API key; set COMFY_BASE_URL to a self-hosted comfy-api-proxy to use a deployment that does not.`; `exit=1`; curl `(7)` | `comfy-target.ts` `resolveComfyTarget` |
| CF-02 | `COMFY_API_KEY=qa-dummy` | stdout `{"auth":"bearer","base":"https://cloud.comfy.org","event":"comfy.target","target":"cloud"}`, then srvx's listening line (observed: `➜ Listening on: http://localhost:3099/ (all interfaces)`); healthz 200 | `comfy-boot.ts`; `COMFY_CLOUD_BASE_URL` in `node_modules/@comfyorg/sdk/src/sdk/client.ts` |
| CF-03 | `COMFY_BASE_URL=http://127.0.0.1:1` | `{"auth":"none","base":"http://127.0.0.1:1","event":"comfy.target","target":"selfhost"}`; healthz 200 | `comfy-target.ts` |
| CF-04 | `COMFY_BASE_URL='http://x?y'` | stderr has `Error: COMFY_BASE_URL must be an http(s) URL with no query or fragment, such as https://<host>:8189, not "http://x?y"`; `exit=1`; curl `(7)` | `comfy-target.ts` |
| CF-05 | `COMFY_BASE_URL=https://cloud.comfy.org:443/ COMFY_API_KEY=qa-dummy` | `{"auth":"bearer","base":"https://cloud.comfy.org:443","event":"comfy.target","target":"cloud"}` (same origin and path as Cloud) | `comfy-target.ts` |
| CF-06 | `COMFY_BASE_URL=https://cloud.comfy.org/self-hosted` | `{"auth":"none","base":"https://cloud.comfy.org/self-hosted","event":"comfy.target","target":"selfhost"}` (other path = not Cloud, key optional) | `comfy-target.ts` |
| CF-07 | `COMFY_BASE_URL='   ' COMFY_API_KEY=qa-dummy` | blank counts as unset: `{"auth":"bearer","base":"https://cloud.comfy.org","event":"comfy.target","target":"cloud"}` | `comfy-target.ts` (`.trim() \|\| COMFY_CLOUD_BASE_URL`) |
| CF-08 | `COMFY_BASE_URL='not a url'` | stderr has `Error: COMFY_BASE_URL is not a URL: "not a url"`; `exit=1` | `comfy-target.ts` |

Example, CF-01 (exits) then CF-02 (boots; Ctrl+C after the curl):

```sh
boot > "$QA/CF-01.log" 2>&1; echo "exit=$?" | tee -a "$QA/CF-01.log"
boot COMFY_API_KEY=qa-dummy 2>&1 | tee "$QA/CF-02.log"
```

- Evidence: `$QA/CF-<nn>.log` per row, plus the curl result pasted into the results table.
- Cleanup: Ctrl+C every booted server; the temporary databases are under `mktemp -d`.

### CF-09 Same check in the production image

- Precondition: Docker running.
- Steps:

  ```sh
  docker build -t open-photon:qa . > "$QA/CF-09-build.log" 2>&1; echo "exit=$?"
  docker run --rm open-photon:qa > "$QA/CF-09-nokey.log" 2>&1; echo "exit=$?" | tee -a "$QA/CF-09-nokey.log"
  docker run --rm --name open-photon-qa-cf -e COMFY_API_KEY=qa-dummy -p 127.0.0.1:3099:3000 open-photon:qa 2>&1 | tee "$QA/CF-09-key.log"
  ```

- Expected: build `exit=0`. No key: the CF-01 error line, `exit=1`. Dummy key: the CF-02 JSON line before srvx's listening line; `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3099/healthz` gives `200`.
- Evidence: the three logs.
- Cleanup: `docker stop open-photon-qa-cf`; `docker image rm open-photon:qa` at teardown.

## Phase 2: `check:comfy` matrix

`scripts/check-comfy.mjs` resolves the target like the server, prints `comfy target=<kind> base=<url> auth=<bearer|none>`, then fetches one job id that cannot exist (`GET <base>/api/v2/jobs/<uuid>`, bearer when a key is set) and prints `OK: …` (exit 0) or `FAIL: …` (exit 1). A 404 counts as OK only with the API v2 error envelope (`{ error: { code: "not_found" | "job_not_found" } }`); a plain 404 means no API v2 at that URL. `npm run check:comfy` also reads `.env`; a variable already in the environment wins over `.env`. The stub rows run `node scripts/check-comfy.mjs` directly so `.env` cannot interfere.

Throwaway stub, saved outside the repository (so `npm run check` never sees it) as `/tmp/comfy-stub.mjs`:

```js
import { createServer } from "node:http";

const mode = process.env.MODE ?? "ok"; // ok | 401 | 403 | raw | plain
const port = Number(process.env.PORT ?? 8199);

createServer((req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // What aiohttp (ComfyUI) or any server at a wrong path answers: a 404 with no envelope.
  const plain404 = () => {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404: Not Found");
  };

  if (req.url.startsWith("/api/v2/jobs/")) {
    if (mode === "401") return json(401, { error: { code: "unauthorized", message: "invalid token" } });
    if (mode === "403") return json(403, { error: { code: "forbidden", message: "forbidden" } });
    if (mode === "raw" || mode === "plain") return plain404();
    return json(404, { error: { code: "not_found", message: "job not found" } });
  }

  // ComfyUI's native server answers /system_stats; comfy-api-proxy does not.
  if (req.url === "/system_stats" && mode === "raw") {
    return json(200, { system: { comfyui_version: "0.42.0" } });
  }

  plain404();
}).listen(port, "127.0.0.1", () => console.log(`stub ${mode} on 127.0.0.1:${port}`));
```

Run the stub in one terminal (`MODE=<mode> node /tmp/comfy-stub.mjs`), the check in another, then stop the stub. The 401/403/not-found bodies follow the API v2 envelope `{ error: { code, message } }`; `raw` and `plain` answer `/api/v2/*` with a bare 404, as ComfyUI's own server or a wrong path does.

| ID | Stub | Check command | Expected stdout | Expected stderr, exit | Source |
| --- | --- | --- | --- | --- | --- |
| CC-01 | `MODE=ok` | `env -i PATH="$PATH" COMFY_BASE_URL=http://127.0.0.1:8199 node scripts/check-comfy.mjs` | `comfy target=selfhost base=http://127.0.0.1:8199 auth=none` / `OK: reachable and authorized (an unknown job id is 404 not found)` | none, 0 | `check-comfy.mjs` |
| CC-02 | `MODE=401` | same plus `COMFY_API_KEY=wrong` | `comfy target=selfhost base=http://127.0.0.1:8199 auth=bearer` | `FAIL: wrong or missing token: http://127.0.0.1:8199 answered 401 (unauthorized). Set COMFY_API_KEY to the comfy-api-proxy --token.`, 1 | `check-comfy.mjs` |
| CC-03 | `MODE=403` | as CC-02 | as CC-02 | `FAIL: wrong or missing token: http://127.0.0.1:8199 answered 403 (forbidden). Set COMFY_API_KEY to the comfy-api-proxy --token.`, 1 | `check-comfy.mjs` |
| CC-04 | `MODE=raw` | as CC-01 | `comfy target=selfhost base=http://127.0.0.1:8199 auth=none` | `FAIL: this is raw ComfyUI on its native port; run comfy-api-proxy and point COMFY_BASE_URL at it (8189)`, 1 | `check-comfy.mjs` (`isRawComfyUi`) |
| CC-05 | `MODE=plain` | as CC-01 | as CC-04 | `FAIL: no Comfy API v2 at http://127.0.0.1:8199: 404 without an error envelope. Check the URL path and port (a comfy-api-proxy serves /api/v2 at its root).`, 1 | `check-comfy.mjs` |
| CC-06 | stopped | as CC-01 | as CC-01, first line only | `FAIL: unreachable: Could not connect to Comfy (ECONNREFUSED).`, 1 | `check-comfy.mjs`, `providerError` in `src/shared/server/comfy-provider.ts` |
| CC-07 | none | `env -i PATH="$PATH" COMFY_BASE_URL=http://127.0.0.1:1 node scripts/check-comfy.mjs` | `comfy target=selfhost base=http://127.0.0.1:1 auth=none` | `FAIL: unreachable: Could not connect to Comfy (bad port).`, 1 | `comfy-provider.ts` (`bad port`) |
| CC-08 | none | `env -i PATH="$PATH" node scripts/check-comfy.mjs` | nothing | `FAIL: COMFY_API_KEY is not set. Comfy Cloud (https://cloud.comfy.org, used while COMFY_BASE_URL is unset) requires an API key; set COMFY_BASE_URL to a self-hosted comfy-api-proxy to use a deployment that does not.`, 1 | `comfy-target.ts` |

CC-01 to CC-08 strings are the ones `scripts/check-comfy.mjs` emits as of 2026-10-22; re-run them after any change to that script.

- Evidence: `$QA/CC-<nn>.log` per row (`… > "$QA/CC-01.log" 2>&1; echo "exit=$?" >> "$QA/CC-01.log"`).
- Cleanup: stop the stub; `rm /tmp/comfy-stub.mjs` at teardown.

### CC-09 Comfy Cloud, real key

- Precondition: `.env` from `cp .env.example .env` with `COMFY_API_KEY=<cloud key>` and `COMFY_BASE_URL` unset or blank.
- Steps:

  ```sh
  npm run -s check:comfy > "$QA/CC-09.log" 2>&1; echo "exit=$?" >> "$QA/CC-09.log"
  COMFY_API_KEY=qa-wrong-key npm run -s check:comfy > "$QA/CC-09-wrong.log" 2>&1; echo "exit=$?" >> "$QA/CC-09-wrong.log"
  ```

- Expected: `comfy target=cloud base=https://cloud.comfy.org auth=bearer`, `OK: reachable and authorized (an unknown job id is 404 not found)`, `exit=0`. Wrong key: `FAIL: wrong or missing token: https://cloud.comfy.org answered 401 (<code>). Set COMFY_API_KEY to a valid Comfy Cloud API key.` (or `403`; the `(<code>)` part appears only when Cloud sends an error envelope), `exit=1`. Record what Cloud returns. Source: `check-comfy.mjs`.
- Evidence: both logs.
- Cleanup: none.

The pod row of this matrix is [P-01](#p-01-checkcomfy-against-the-pod-gpu).

## Phase 3: Comfy Cloud end to end

Precondition for the phase: `.env` as in CC-09, CC-09 passed, `IN_FLIGHT_MAX` not set in `.env` (default 1).

### C-01 Compose up on Cloud

- Steps:

  ```sh
  docker compose up --build -d > "$QA/C-01-build.log" 2>&1; echo "exit=$?"
  docker compose logs app > "$QA/C-01-app.log" 2>&1
  curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3030/healthz
  ```

- Expected: `exit=0`; `$QA/C-01-app.log` contains `{"auth":"bearer","base":"https://cloud.comfy.org","event":"comfy.target","target":"cloud"}` before the listening line; healthz `200`. Source: `comfy-boot.ts`; port mapping `127.0.0.1:3030:3000` in `compose.yaml`.
- Evidence: both logs.
- Cleanup: keep running.

### C-02 Mint an access code

- Steps: `docker compose exec app node scripts/mint-code.mjs qa 10 | tee "$QA/C-02.code"`
- Expected: one 24-character URL-safe code on stdout, exit 0 (`scripts/mint-code.mjs`). Export it as `ACCESS_CODE` and run the cookie helper; `$COOKIE` starts with `photon_access=`.
- Evidence: `$QA/C-02.code` (a QA-only code; revoke or delete the volume at teardown).
- Cleanup: none.

### C-03 Access gate

- Steps: `BASE_URL=http://localhost:3030 node scripts/verify-access.mjs > "$QA/C-03.log" 2>&1; echo "exit=$?" >> "$QA/C-03.log"`
- Expected: last line `Access verification passed: the picker is open, actions and private media need a session, login, CSRF, validation and private video ranges work. No paid jobs submitted.`, `exit=0`. Source: `scripts/verify-access.mjs`.
- Evidence: `$QA/C-03.log`.
- Cleanup: none.

### C-04 Queue full without spending (`IN_FLIGHT_MAX=0`)

- Steps:
  1. Add `IN_FLIGHT_MAX=0` to `.env`; `docker compose up -d --force-recreate`.
  2. In the browser, open <http://localhost:3030> → Motion Transfer. Step 1: upload `work/qa/qa-motion.mp4`. Step 2: the chosen sample character. Step 3: Advanced → seed `<seed>`. Generate; enter `$ACCESS_CODE` when asked.
  3. In DevTools Network, open the `POST /api/generate` response.
- Expected: status `503`, header `Retry-After: 30`, body `{"error":"Queue full: every rendering slot is taken. Try again in 30 s.","reason":"queue_full","retry_after":30}`; the form shows the refusal under the button; no `/g/<id>` opens, no row is created. Source: `submitRecipe` and `handleGenerate` in `src/features/motionTransfer/server/generate.ts` (`QUEUE_RETRY_AFTER = 30`); README "Rate limits and the in-flight cap".
- Evidence: screenshot `$QA/C-04.png`, the response copied to `$QA/C-04.json`.
- Cleanup: remove `IN_FLIGHT_MAX=0` from `.env`; `docker compose up -d --force-recreate`; confirm the `comfy.target` line again.

### C-05 Oversize upload is refused by the app (free)

- Steps:

  ```sh
  dd if=/dev/urandom of=work/qa/qa-oversize.mp4 bs=1048576 count=130
  curl -sS -w '\n%{http_code}\n' -H "Cookie: $COOKIE" -F file=@work/qa/qa-oversize.mp4 \
    http://localhost:3030/api/uploads | tee "$QA/C-05.log"
  ```

  Then pick the same file in the wizard's step 1.
- Expected: `{"error":"Maximum file size is 128 MiB"}` and `413` (if the app closes the connection before curl finishes sending, curl may add a send error; the status is what counts); the UI says `This file is over 128 MiB.`. The limit is 134,217,728 bytes plus 64 KiB of multipart framing (`MAX_UPLOAD_BYTES`, `src/shared/server/upload.server.ts`; UI text: `src/shared/requests.ts`).
- Evidence: `$QA/C-05.log`, screenshot `$QA/C-05.png`.
- Cleanup: `rm work/qa/qa-oversize.mp4` at teardown.

### C-06 One real render through the UI `[COST]`

Spends ≈17.5 Comfy credits (README "Credits").

- Steps:
  1. Note the workspace credit balance (Comfy Cloud console; README "Credits" names the billing endpoint it was read from).
  2. Repeat C-04 step 2 with the same clip, character and seed, "As filmed", no look text. Record these inputs: Phase 6 repeats them exactly.
  3. On `/g/<id>`, watch the stages: preparing, queued, rendering, finishing, done. Copy `<cloud-id>` from the URL.
  4. Read the row and recipe:

     ```sh
     curl -fsS -H "Cookie: $COOKIE" http://localhost:3030/api/generations/<cloud-id> | tee "$QA/C-06-generation.json" | jq '{status, error_code}'
     curl -fsS -H "Cookie: $COOKIE" http://localhost:3030/api/generations/<cloud-id>/recipe.json | tee "$QA/C-06-recipe.json" | jq -r .target
     ```

  5. Note the balance again.
- Expected: Generate opens `/g/<cloud-id>` (201, `reused: false` in the `POST /api/generate` response); the row reaches `done`; `{"status":"done","error_code":null}`; target `cloud`; the balance dropped by about 17.5 credits.
- Evidence: screenshots of `/g/<cloud-id>` while rendering and when done, both JSON files, balance before and after in the results table.
- Cleanup: none (kept for Phase 6).

### C-07 Second concurrent generate is refused (`IN_FLIGHT_MAX=1`)

- Precondition: C-06's row is still `queued` or `running`. Do this right after clicking Generate in C-06.
- Steps: in a second tab, same clip and character, a different seed `<seed2>`, Generate. Inspect `POST /api/generate` in DevTools.
- Expected: after at most 5 s (the in-flight refresh, `REFRESH_WAIT_MS` in `generate.ts`), `503` with the C-04 body; no second row; no credits spent. If C-06 already finished, the second generate submits a paid job instead: mark C-07 "not run", do not retry blindly.
- Evidence: screenshot `$QA/C-07.png`, response `$QA/C-07.json`.
- Cleanup: none.

### C-08 MP4 download and share page

- Precondition: C-06 done.
- Steps:
  1. On `/g/<cloud-id>`, "Download MP4"; save as `$QA/C-08.mp4`.
  2. `ffprobe -v error -show_entries stream=codec_name,codec_type -of csv=p=0 "$QA/C-08.mp4" | tee "$QA/C-08-streams.txt"`
  3. Copy the share link `<origin>/r/<slug>` from the page. Without a cookie: `curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3030/r/<slug>`. Open it in a private window.
- Expected: an `h264,video` stream and one audio stream; share page `200`; the private window plays the result muted and looping (README "Share pages").
- Evidence: `$QA/C-08.mp4`, `$QA/C-08-streams.txt`, screenshot `$QA/C-08-share.png`.
- Cleanup: none.

### C-09 No Comfy errors in the app log

- Steps: `docker compose logs app > "$QA/C-09.log" 2>&1; grep -E '"event":"comfy\.[a-z]+-error"' "$QA/C-09.log"; echo "grep exit=$?"`
- Expected: no matching line, `grep exit=1`. The events that would match are `comfy.upload-error` and `comfy.submit-error` (`send` in `generate.ts`).
- Evidence: `$QA/C-09.log`.
- Cleanup: none.

## Phase 4: self-host image

### S-01 Build and push the GPU image

- Precondition: logged in to `<registry>`. On Apple Silicon the build is emulated and slow; an x86_64 builder is faster.
- Steps:

  ```sh
  export IMAGE=<registry>/open-photon-comfy:7a28332
  docker build --platform linux/amd64 -f selfhost/Dockerfile -t "$IMAGE" . > "$QA/S-01-build.log" 2>&1; echo "exit=$?"
  docker push "$IMAGE" > "$QA/S-01-push.log" 2>&1; echo "exit=$?"
  ```

- Expected: both `exit=0`; the push log ends with the image digest.
- Evidence: both logs; record the digest.
- Cleanup: none.

### S-02 No token on a public bind stops the container (no GPU)

- Steps:

  ```sh
  docker run --rm --platform linux/amd64 -e PROXY_TOKEN= -e PROXY_HOST=0.0.0.0 "$IMAGE" > "$QA/S-02.log" 2>&1; echo "exit=$?" | tee -a "$QA/S-02.log"
  ```

- Expected: the only output is `PROXY_TOKEN is required when the proxy listens on 0.0.0.0. Set it (the app's COMFY_API_KEY), or PROXY_HOST=127.0.0.1 to serve on loopback only.`, then `exit=64`. Nothing is downloaded and ComfyUI never starts. Source: `selfhost/entrypoint.sh` (the check before `install-models.mjs`).
- Evidence: `$QA/S-02.log`.
- Cleanup: none.

### S-03 A corrupted weight stops the container (no GPU, one download)

The entrypoint never runs `install-models.mjs --verify-only`: with an empty or partial `MODELS_DIR` it downloads what is missing (that is the first-boot path, S-05). A mismatch is tested by corrupting a real file.

- Steps:

  ```sh
  mkdir -p work/qa-models
  node scripts/install-models.mjs work/qa-models --verify-only 2>&1 | grep '^Error: Missing or mismatched model'
  # → Error: Missing or mismatched model: …work/qa-models/<directory>/<file>  (the first file in install order)
  FIRST=<directory>/<file>
  URL=$(jq -r --arg f "$(basename "$FIRST")" '.models[] | select(.file == $f) | .url' src/features/*/workflows/models.lock | head -n 1)
  SHA=$(jq -r --arg f "$(basename "$FIRST")" '.models[] | select(.file == $f) | .sha256' src/features/*/workflows/models.lock | head -n 1)
  mkdir -p "work/qa-models/$(dirname "$FIRST")"
  curl -fL -o "work/qa-models/$FIRST" "$URL"
  shasum -a 256 "work/qa-models/$FIRST"     # equals $SHA
  printf x >> "work/qa-models/$FIRST"       # append one byte
  docker run --rm --platform linux/amd64 -e PROXY_TOKEN=qa \
    -v "$PWD/work/qa-models:/workspace/models" "$IMAGE" > "$QA/S-03.log" 2>&1; echo "exit=$?" | tee -a "$QA/S-03.log"
  ```

- Expected: the hash matches `$SHA` before the append. The container prints no `Verified <file>` for that file and no `Waiting for ComfyUI on 127.0.0.1:8188`; stderr has `Missing or mismatched model: /workspace/models/<directory>/<file>`; `exit=1`. Source: `scripts/install-models.mjs` (`Missing or mismatched model: ${destination}`); the installer never replaces an existing file.
- Evidence: `$QA/S-03.log`, the two hashes.
- Cleanup: `rm -rf work/qa-models` at teardown.

### S-04 Secret and template

- Steps:
  1. `openssl rand -hex 32` → create the RunPod secret `open_photon_proxy_token` (Console → Secrets) with that value. Keep it as `<token>`; do not paste it into evidence.
  2. Create the template (SETUP.md "Run on your own infra", step 3):

     ```sh
     jq --arg image "$IMAGE" '. + {imageName: $image}' selfhost/runpod-template.json |
       curl -fsS https://rest.runpod.io/v1/templates \
         -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' --data @- |
       tee "$QA/S-04-template.json" | jq -r .id
     ```

- Expected: a template `id`; `runpodctl template get <template-id>` shows port `8189/http` only, `PROXY_TOKEN` = `{{ RUNPOD_SECRET_open_photon_proxy_token }}`, `MAX_UPLOAD_MB` `128`, volume at `/workspace` (`selfhost/runpod-template.json`).
- Evidence: `$QA/S-04-template.json`.
- Cleanup: template and secret at teardown (T-04).

### S-05 Network volume, pod and first boot `[GPU]` `[COST]`

Billing starts here.

- Steps:

  ```sh
  runpodctl network-volume create --name open-photon-models --size 50 --data-center-id <dc> | tee "$QA/S-05-volume.json"
  runpodctl pod create --name open-photon-comfy --template-id <template-id> \
    --gpu-id "NVIDIA GeForce RTX 5090" --min-cuda-version 13.0 --data-center-ids <dc> \
    --network-volume-id <volume-id> --volume-mount-path /workspace | tee "$QA/S-05-pod.json"
  runpodctl pod logs <pod-id> --follow | tee "$QA/S-05-boot.log"
  ```

- Expected in the container log (SETUP.md step 5; sources in brackets). Model installation completes before the waiting/preflight phase, and preflight completes before the serving message; ComfyUI's own output is asynchronous and may interleave with the entrypoint lines.
  1. For each locked file: `Downloading <file>` then `Verified <file>` (first boot) [`install-models.mjs`]. Five files today.
  2. `Waiting for ComfyUI on 127.0.0.1:8188` [`entrypoint.sh`]. ComfyUI's own startup output may appear before or after this line.
  3. One preflight line per runtime workflow, then the summary: `motionTransfer/motion-transfer.v1: 5 model files, 5 locked, 0 missing` and `5 distinct model files across 1 feature lock, 0 conflicts` [`check-models-lock.mjs --definitions`].
  4. `Serving the Comfy API v2 on 0.0.0.0:8189 (auth: bearer)` [`entrypoint.sh`].

  No `ComfyUI exited (…); stopping.` or `comfy-api-proxy exited (…); stopping.` line follows (either one means the container is going down).
- Evidence: `$QA/S-05-boot.log`, the pod and volume JSON. Record the time from `pod create` to line 4.
- Cleanup: T-01 to T-03.

### S-06 Proxy auth from outside `[GPU]`

- Steps:

  ```sh
  P=https://<pod-id>-8189.proxy.runpod.net
  J=00000000-0000-4000-8000-000000000000
  curl -sS -o /dev/null -w 'health %{http_code}\n' "$P/api/v2/health" | tee "$QA/S-06.log"
  curl -sS -o /dev/null -w 'no token %{http_code}\n' "$P/api/v2/jobs/$J" | tee -a "$QA/S-06.log"
  curl -sS -o /dev/null -w 'token %{http_code}\n' -H "Authorization: Bearer <token>" "$P/api/v2/jobs/$J" | tee -a "$QA/S-06.log"
  ```

- Expected: `health 200` (no token needed), `no token 401`, `token 404`. Basis: the contract's proxy facts (`GET /api/v2/health` needs no token; `PROXY_TOKEN` guards `/api/v2/*`) and the 404 for an unknown job that `check-comfy.mjs` treats as OK.
- Evidence: `$QA/S-06.log`.
- Cleanup: none.

### S-07 Second boot re-verifies without downloading `[GPU]` `[COST]`

- Steps: `runpodctl pod restart <pod-id>`, then `runpodctl pod logs <pod-id> --follow | tee "$QA/S-07-boot.log"`.
- Expected: the S-05 sequence without any `Downloading <file>` line: five `Verified <file>`, then lines 2–4. The weights persisted on the network volume.
- Evidence: `$QA/S-07-boot.log`; record the time to `Serving …` (re-hash duration is not documented anywhere).
- Cleanup: none.

## Phase 5: app against the pod

Precondition for the phase: S-05 passed and the pod is running.

### P-01 `check:comfy` against the pod `[GPU]`

- Steps: in `.env`, set `COMFY_BASE_URL=https://<pod-id>-8189.proxy.runpod.net` and `COMFY_API_KEY=<token>`. Then `npm run -s check:comfy > "$QA/P-01.log" 2>&1; echo "exit=$?" >> "$QA/P-01.log"`.
- Expected:

  ```text
  comfy target=selfhost base=https://<pod-id>-8189.proxy.runpod.net auth=bearer
  OK: reachable and authorized (an unknown job id is 404 not found)
  exit=0
  ```

  Source: `check-comfy.mjs`; SETUP.md step 7.
- Evidence: `$QA/P-01.log`.
- Cleanup: none.

### P-02 App restarts on the pod target `[GPU]`

- Steps: `docker compose up -d --force-recreate`; `docker compose logs app > "$QA/P-02.log" 2>&1`.
- Expected: `{"auth":"bearer","base":"https://<pod-id>-8189.proxy.runpod.net","event":"comfy.target","target":"selfhost"}`; healthz `200`. Same database volume as Phase 3; `$ACCESS_CODE` still works.
- Evidence: `$QA/P-02.log`.
- Cleanup: none.

### P-03 Render, record VRAM, and verify `[GPU]` `[COST]`

Steps from docs/selfhost.md "Verify".

- Steps:
  1. Open a shell on the pod (`runpodctl ssh info <pod-id>` prints the SSH command). If the pod offers no SSH, mark P-03 blocked: the VRAM recording needs `nvidia-smi` on the pod.
  2. On the pod, before Generate:

     ```sh
     mkdir -p work
     TZ=UTC nvidia-smi --query-gpu=timestamp,name,memory.used \
       --format=csv,noheader,nounits -l 1 | tee work/vram.csv
     ```

  3. In the app, the exact C-06 inputs (clip, character, seed, angle, look). Generate. Copy `<selfhost-id>` from `/g/<id>`. Keep the recording running until the page shows done, then stop it (Ctrl+C).
  4. Copy `work/vram.csv` from the pod to the local `work/vram.csv` (`runpodctl send work/vram.csv` on the pod and `runpodctl receive <code>` locally, or `cat` it in the SSH session and save the output).
  5. Locally:

     ```sh
     BASE_URL=http://localhost:3030 ACCESS_CODE="$ACCESS_CODE" VRAM_CSV=work/vram.csv \
       node scripts/verify-selfhost.mjs <selfhost-id> > "$QA/P-03.log" 2>&1; echo "exit=$?" >> "$QA/P-03.log"
     ```

  6. Play the result in the compare view; confirm the character moves and the driving clip's audio plays.
- Expected: Generate opens a new `/g/<selfhost-id>` (not `<cloud-id>`: the recipe hash includes the target). `exit=0` and a JSON report with `"target": "selfhost"`, `resolution`, `clip_seconds`, `submitted_to_done_seconds`, `peak_vram_mib`, `vram_samples`, `workflow_sha256`, `models`, `output_sha256`; files `work/selfhost-<selfhost-id>.json` and `work/selfhost-<selfhost-id>.mp4`. The script asserts `done`, `target: selfhost`, the workflow hash, all five model pins, an H.264 stream and an audio stream that decode, and a recording that spans the render (its failure messages: `GPU recording must start before submission`, `GPU recording must continue until done`, `GPU samples must overlap this generation`, `Record timestamps with TZ=UTC`). The report's `gpu` and `variant` fields are constants in the script, not measurements: check the GPU name in the CSV's second column. For comparison only (no pass threshold): the proof measured 31,066 MiB peak and 158.717 s submission to done (README).
- Evidence: `$QA/P-03.log`, `work/vram.csv`, `work/selfhost-<selfhost-id>.json`, `work/selfhost-<selfhost-id>.mp4` (move them into `$QA/`), a note on playback and audio.
- Cleanup: none.

### P-04 RunPod's 100 s stream cut during P-03 `[GPU]`

Observed during P-03, not a separate render.

- Steps: before Generate in P-03, open DevTools Network on `/g/<selfhost-id>`, filter `events`. Watch the `GET /api/generations/<selfhost-id>/events` EventStream tab and the progress on the page for the whole render. Afterwards `docker compose logs app > "$QA/P-04.log" 2>&1`.
- Expected: RunPod's proxy may cut the app's job stream from the pod (`GET /api/v2/jobs/{id}/events`) after 100 s; the SDK then reads `GET /api/v2/jobs/{id}` and reconnects (`node_modules/@comfyorg/sdk/src/sdk/jobs.ts`). In the browser: progress pauses or jumps; the browser's own stream to the app stays open (`: ping` every 15 s, README "Generating"); a `provider_unavailable` event, if any, is followed by a reconnect after its `retry:` delay (`src/features/motionTransfer/server/generation-stream.ts`). Pass: the row reaches `done` and never `failed`; `$QA/P-04.log` has no `comfy.upload-error`/`comfy.submit-error` line. Record whether a pause was seen; "not observed" is not a failure.
- Evidence: screen recording or screenshots around the pause, a HAR export `$QA/P-04.har`, `$QA/P-04.log`.
- Cleanup: none.

### P-05 A 100–128 MiB clip reaches ComfyUI `[GPU]` `[COST]`

ComfyUI's own default upload limit is 100 MiB; the image raises it to `MAX_UPLOAD_MB + 1` and the proxy to `MAX_UPLOAD_MB` (`selfhost/entrypoint.sh`). This case renders once.

- Steps:
  1. Make a 3–8 s clip with audio whose size is above 104,857,600 bytes (100 MiB) and at most 134,217,728 bytes (128 MiB). Constant-bitrate H.264 with filler gets there; pick the bitrate as target bytes × 8 / duration and adjust until the size fits:

     ```sh
     ffmpeg -i work/qa/qa-motion.mp4 -c:v libx264 -preset veryfast \
       -b:v <rate> -minrate <rate> -maxrate <rate> -bufsize <rate> -x264-params nal-hrd=cbr \
       -c:a aac work/qa/qa-large.mp4
     stat -f %z work/qa/qa-large.mp4    # macOS; Linux: stat -c %s
     ```

  2. Upload it in the wizard's step 1, the usual character, Generate.
  3. `docker compose logs app > "$QA/P-05.log" 2>&1`; read the row as in C-06.
- Expected: the app accepts the upload (201); the generation passes `preparing` to `queued` (the proxy and ComfyUI accepted both files) and reaches `done`; no `comfy.upload-error` in `$QA/P-05.log`. A failure here shows as `error_code` `provider_rejected` with `Comfy refused the request (…) … Nothing was submitted.` (SETUP.md "413 on uploads").
- Evidence: the file size, `$QA/P-05.log`, the generation JSON.
- Cleanup: `rm work/qa/qa-large.mp4` at teardown.

### P-06 Over 128 MiB is refused at the app

Repeat C-05 against the app now pointed at the pod. Expected identical: `413`, `{"error":"Maximum file size is 128 MiB"}`, nothing reaches the pod. Evidence `$QA/P-06.log`.

### P-07 Wrong token fails the generation as `provider_rejected` `[GPU]`

- Steps:
  1. In `.env`, set `COMFY_API_KEY=qa-wrong-token` (keep the pod URL). `npm run -s check:comfy > "$QA/P-07-check.log" 2>&1; echo "exit=$?" >> "$QA/P-07-check.log"`.
  2. `docker compose up -d --force-recreate`; check the `comfy.target` line.
  3. In the app, a recipe not rendered yet on self-host (the C-06 inputs with seed `<seed3>`). Generate.
  4. Read the row as in C-06; `docker compose logs app > "$QA/P-07-app.log" 2>&1`.
- Expected:
  - Check: `comfy target=selfhost base=https://<pod-id>-8189.proxy.runpod.net auth=bearer`, then `FAIL: wrong or missing token: https://<pod-id>-8189.proxy.runpod.net answered 401 (<code>). Set COMFY_API_KEY to the comfy-api-proxy --token.`, `exit=1` (`check-comfy.mjs`).
  - Boot: the app still starts (`{"auth":"bearer",…,"target":"selfhost"}`); the server checks config, not the token.
  - Generation: opens `/g/<id>`, which shows failed. Row: `"status":"failed"`, `"error_code":"provider_rejected"`, `error_message` starting `Comfy refused the request (` and ending `Nothing was submitted.`. App log: `{"code":"provider_rejected","event":"comfy.upload-error","id":"<id>"}`. Sources: `providerError` in `src/shared/server/comfy-provider.ts` (any 4xx → `provider_rejected`), `send` in `generate.ts` (uploads go first; their failure appends ` Nothing was submitted.`); `generationErrorCodeSchema` in `src/features/motionTransfer/contracts.ts`. Nothing renders; the access code's count is given back (README "Access codes").
  - Variant: blank `COMFY_API_KEY` gives `auth=none` and the same `answered 401` failure.
- Evidence: both logs, the generation JSON, screenshot `$QA/P-07.png`.
- Cleanup: restore `COMFY_API_KEY=<token>`; `docker compose up -d --force-recreate`; P-01 passes again.

After P-07, run [T-01](#t-01-stop-the-pod-cost). Phase 6 needs no GPU.

## Phase 6: switching targets

### X-01 Same inputs, two rows, two targets

- Precondition: C-06 and P-03 done with identical inputs.
- Steps:

  ```sh
  for id in <cloud-id> <selfhost-id>; do
    curl -fsS -H "Cookie: $COOKIE" http://localhost:3030/api/generations/$id/recipe.json | jq -c '{target, seed: .params.seed}'
  done | tee "$QA/X-01.log"
  ```

- Expected: two different ids, both `done`; targets `cloud` and `selfhost`, the same seed. The recipe hash includes `target`, so the self-host Generate did not reuse the Cloud result (README "Recipes and re-runs"; SETUP.md "Switching targets").
- Evidence: `$QA/X-01.log`.
- Cleanup: none.

### X-02 Back to Cloud

- Steps: in `.env`, blank `COMFY_BASE_URL` and set `COMFY_API_KEY=<cloud key>`. `npm run -s check:comfy > "$QA/X-02-check.log" 2>&1`; `docker compose up -d --force-recreate`; `docker compose logs app > "$QA/X-02-app.log" 2>&1`.
- Expected: check prints the CC-09 OK lines; the app logs `{"auth":"bearer","base":"https://cloud.comfy.org","event":"comfy.target","target":"cloud"}` and serves healthz `200`.
- Evidence: both logs.
- Cleanup: none.

### X-03 Cloud reuses its own result (free)

- Steps: in the app, the exact C-06 inputs again. Generate. Inspect `POST /api/generate` in DevTools.
- Expected: `200` with `{"id":"<cloud-id>","reused":true}`; the page opens `/g/<cloud-id>` straight to its done result; no new row, no credits spent (README "Generating", step 1). Generate takes no rate-limit token for a reused result.
- Evidence: response `$QA/X-03.json`, screenshot.
- Cleanup: none.

## Phase 7: teardown

### T-01 Stop the pod `[COST]`

- Steps: `runpodctl pod stop <pod-id>`; `runpodctl pod get <pod-id> | tee "$QA/T-01.json"`.
- Expected: the pod is stopped. A stopped pod still bills for its disk and the network volume keeps billing (SETUP.md step 9).
- Evidence: `$QA/T-01.json`.

### T-02 Delete the pod

- Steps: `runpodctl pod delete <pod-id>`; `runpodctl pod list --all` no longer lists it.

### T-03 Delete the network volume

- Precondition: no pod uses it (T-02). Delete only after the evidence is copied off; the next QA run downloads the weights again.
- Steps: `runpodctl network-volume delete <volume-id>`; `runpodctl network-volume list` no longer lists it.

### T-04 Template and secret

- Steps: `runpodctl template delete <template-id>`; delete the `open_photon_proxy_token` secret in the RunPod console. Remove `<token>` from `.env`.

### T-05 Local cleanup

- Steps:

  ```sh
  docker compose down            # add -v only if the sqlite-data volume holds nothing but QA data
  docker image rm open-photon:qa "$IMAGE"
  rm -rf work/qa-models work/qa/qa-oversize.mp4 work/qa/qa-large.mp4 /tmp/comfy-stub.mjs
  ```

  Restore `.env` to the configuration you run day to day. If the Compose volume is kept, revoke the QA code: from a shell with access to the database, `UPDATE access_codes SET revoked_at = datetime() WHERE label = 'qa'` (README "Access codes").

## Results table

| ID | Pass/Fail | Evidence path | Notes |
| --- | --- | --- | --- |
| ST-01 | | | |
| ST-02 | | | |
| ST-03 | | | |
| ST-04 | | | |
| ST-05 | | | |
| ST-06 | | | |
| ST-07 | | | optional |
| CF-01 | | | |
| CF-02 | | | |
| CF-03 | | | |
| CF-04 | | | |
| CF-05 | | | |
| CF-06 | | | |
| CF-07 | | | |
| CF-08 | | | |
| CF-09 | | | |
| CC-01 | | | |
| CC-02 | | | |
| CC-03 | | | |
| CC-04 | | | |
| CC-05 | | | |
| CC-06 | | | |
| CC-07 | | | |
| CC-08 | | | |
| CC-09 | | | Cloud's 401/403 code: |
| C-01 | | | |
| C-02 | | | |
| C-03 | | | |
| C-04 | | | |
| C-05 | | | |
| C-06 | | | credits before / after: |
| C-07 | | | |
| C-08 | | | |
| C-09 | | | |
| S-01 | | | image digest: |
| S-02 | | | |
| S-03 | | | file corrupted: |
| S-04 | | | template id: |
| S-05 | | | create → `Serving` time: |
| S-06 | | | |
| S-07 | | | restart → `Serving` time: |
| P-01 | | | |
| P-02 | | | |
| P-03 | | | peak MiB / submission→done s: |
| P-04 | | | pause observed (yes/no): |
| P-05 | | | file bytes: |
| P-06 | | | |
| P-07 | | | proxy's 401 code: |
| X-01 | | | |
| X-02 | | | |
| X-03 | | | |
| T-01 | | | |
| T-02 | | | |
| T-03 | | | |
| T-04 | | | |
| T-05 | | | |

## Teardown checklist

- [ ] Pod stopped (T-01). A stopped pod still bills for its disk.
- [ ] Pod deleted (T-02).
- [ ] Network volume deleted (T-03). It bills until deleted, with or without a pod.
- [ ] Template deleted and `open_photon_proxy_token` secret removed (T-04).
- [ ] `runpodctl pod list --all` and `runpodctl network-volume list` show nothing from this run.
- [ ] Compose stack down; QA images and scratch files removed; `.env` restored (T-05).
- [ ] QA access code revoked, or the QA-only volume removed.
- [ ] Comfy Cloud balance noted after the run (C-06 is the only Cloud spend in this plan).
- [ ] Evidence under `$QA` complete for every row of the results table.
