---
name: add-new-feature
description: Use when asked to add a feature, tool, ComfyUI workflow or model to open-photon; covers the feature layout, workflow and node rules, model pins, the server path, image packaging and the verification gate on both Comfy Cloud and self-hosted ComfyUI (RunPod).
---

# Add a feature to open-photon

One code path for both targets: Comfy API v2 through `@comfyorg/sdk`. `COMFY_BASE_URL` blank =
Comfy Cloud; any other URL = `selfhost` (ComfyUI behind `comfy-api-proxy`, built from `selfhost/`).
One target per app process, never per feature. Do the steps in order; write each step's decision
into your plan. "Stop and ask" = report what you found and ask the user; no workaround.

## 0. Read first, then choose the generation lifecycle

Read `AGENTS.md` (binding), `SETUP.md`, `docs/selfhost.md`, `docs/parallel-feature-foundation.md`,
the reference `src/features/motionTransfer/` (files named below) and its routes
`src/routes/motionTransfer.tsx`, `api.generate.ts`, `api.generations.*`.

Shared today (import these, never copy them):

| Concern | Module |
| --- | --- |
| Target (`comfyTarget`, `ComfyTarget`) | `src/shared/server/comfy-target.ts` |
| Provider (`comfyProvider`, `Provider`, `ProviderJob`, `providerError`) | `src/shared/server/comfy-provider.ts` |
| Uploaded-file reference (`assetReferenceSchema`, `AssetReference`) | `src/shared/server/comfy-assets.ts` |
| API-format graph (`workflowGraphSchema`, `WorkflowGraph`) | `src/shared/server/workflow-graph.ts` |
| Model pins (`lockedModels`, `readModelsLock`, `aggregateModelsLocks`; `readModelsLock` validates against the module-private lock schema) | `src/shared/server/models-lock.ts` |
| Runtime-workflow discovery (`discoverWorkflows`) | `src/shared/server/comfy-workflows.ts` |
| Assets, database, access, limits, uploads | `src/shared/server/{assets,db.server,access.server,limits,upload.server}.ts` |

Motion Transfer's own (not reusable as is):

| Concern | Where | Why |
| --- | --- | --- |
| Admission, idempotency, submit, `unknown` handling | `server/generate.ts` | built around MT params and files |
| `generations` table access | `server/generations.ts` | every row is parsed with MT's `recipeSchema`; `refreshInFlight` reads the oldest in-flight rows through it |
| Finalize | `server/finalize.ts` | downloads one MP4 from MT's `OUTPUT_NODE` and cuts a JPEG poster |
| Progress streaming | `server/generation-stream.ts` | MT generation rows |
| Recipe schema and hash | `server/recipe.ts` | `params` are MT's |
| Public pages and server functions | `server/public-access.ts` | app-wide allowlist that lives in MT |

Planned in `docs/parallel-feature-foundation.md`, **not available**: a shared generation service
(`generations.submit`/`submitMany`), durable queue and scheduler, named outputs with media kinds,
versioned recipes, namespaced migrations, feature seeders, feature-local test discovery, a fake
provider, a client tool catalog, import-boundary CI. Never write code against them.

**Decision A.** Does the feature submit a ComfyUI job?

- No: skip steps 2–3 and the render rows of step 6.
- Yes: choose, and write "Lifecycle: (a)|(b) because …" in the plan:
  - **(a)** Implement the extraction first (foundation doc, work package 1), Motion Transfer as its
    first consumer with public URLs, historical recipes and their hashes unchanged. Larger
    change; get the user's agreement.
  - **(b)** The feature's own server path, keeping MT's invariants:
    1. Persist a row with a fresh idempotency key before anything reaches Comfy; submit with
       `provider.submit(graph, idempotencyKey)`; store the job id the moment it returns.
    2. On a submit error, `providerError(cause).refused` → `failed`; anything else → `unknown`,
       never resubmitted automatically (Comfy forgets a key after a day).
    3. A recipe holding everything that determines the output, `target` included; same hash
       done or pending → return it, submit nothing.
    4. Access-code counting and rate limits as `generate.ts` does (`src/shared/server/limits.ts`).
    5. Own table through a new migration `src/shared/server/migrations/<next NNN>-<name>.sql`
       (one global sequence; `001`–`007` exist). Never insert rows into `generations`.
    6. `IN_FLIGHT_MAX` (`inFlightMax()`) is app-wide, but MT's `countInFlight()` counts only
       `generations`. State how the cap stays global across both tables (a shared count in
       `src/shared/server/`), or stop and ask.

## 1. Feature skeleton

```text
src/features/<feature>/
  contracts.ts            zod schemas + types for request/response bodies (client-safe)
  <name>.functions.ts     createServerFn; server modules via `await import("#/…")` inside handlers
  components/             React; imports with `#/`
  server/                 Node-only; relative imports with the `.ts` extension
  workflows/              <id>.v1.json, <id>.v1.inputs.json, models.lock, params.ts, registry.ts
  samples/                optional
src/routes/<path>.tsx     thin: imports from the feature and shared only
```

- Everything under `server/` or `workflows/`, and what it imports, uses relative `.ts` imports
  (`npm run test:server` runs them in Node); client code uses `#/`.
- Server-function ids are `<source path>#<export>`. Any server function needs a session unless it
  is in `publicServerFns`; any page without a session redirects to `/access` unless
  `isPublicRequest` allows it (both in `src/features/motionTransfer/server/public-access.ts`).
  Public = an explicit edit there. Moving a `*.functions.ts` file means updating its ids.
- Routes: keep `createFileRoute(...)({ validateSearch, loaderDeps, loader, head, component })` in
  that order. API routes: `server: { handlers: { POST: ({ request }) => handleX(request) } }`
  (`src/routes/api.generate.ts`). `src/routeTree.gen.ts` regenerates on `npm run dev` or
  `vite build`; commit it. Route type assertions go in `tests/type-contracts.ts`.
- UI primitives: `npx shadcn@latest add <component>` (lands in `src/components/ui/`).
- Studio home card: `src/features/studio/components/studio-tools.tsx` (`upcoming`); a shared
  tool catalog is planned, not available.
- Tests: `tests/<feature>-*.test.ts` (node:test; import `./temp-database.ts` first when the
  database loads) and `tests/*.spec.ts` (Playwright). Pass a `Provider` double as
  `tests/generate.test.ts` does; tests never render.
- Another feature: import its public API (`contracts.ts`, exported functions); never copy its
  internals. Fallow fails on unused exports and on copy-paste (`fallow dupes`): delete, or move
  the generic part to `src/shared/`.

## 2. Workflow

1. Build it in ComfyUI at the pinned core: `ARG COMFYUI_COMMIT=7a28332047b6af638dc6c7f72ef3481a718769fd`
   (ComfyUI 0.42.0) in `selfhost/Dockerfile`.
2. Export in API format; save as `src/features/<feature>/workflows/<id>.v1.json`. Other files in
   `workflows/` (UI exports, `*.api.json` PoCs, nested provenance folders such as
   `motionTransfer/workflows/wan-animate-2/`) are not runtime workflows.
3. Write `<id>.v1.inputs.json` (shape of `motion-transfer.v1.inputs.json`):

   ```json
   {
     "workflow": "<id>.v1.json",
     "inputs": { "<param>": { "node": "<node id>", "field": "<input>", "class_type": "<class>" } }
   }
   ```

   One entry per param. The field must exist and be a literal, not a `[node, slot]` link, and the
   class must match: MT's `buildGraph` throws otherwise; yours must enforce the same. File inputs
   map to the loader's file field (`LoadImage.image`, `LoadVideo.file`).
4. Declare the output node id as a constant beside the workflow, e.g. in your `registry.ts` (MT's
   is `OUTPUT_NODE = "246"`, its SaveVideo, in `server/finalize.ts`). Named outputs: planned, not available.
5. Node classes, decide per class:
   - ComfyUI core at the pinned commit: fine. Check against a ComfyUI at that commit (a pod):
     `curl -fsS http://127.0.0.1:8188/object_info -o work/object-info.json`, then
     `jq -r '[.[].class_type] | unique[]' <workflow>` and `jq 'has("<Class>")' work/object-info.json`.
     On a pod with the weights installed, `node scripts/check-models-lock.mjs --definitions
     work/object-info.json` checks classes and files for every workflow.
   - Core, but only in a newer ComfyUI: stop and ask. A bump changes `COMFYUI_COMMIT` for every
     feature; every runtime workflow must pass again and the self-host proof is re-run
     (`docs/selfhost.md`, "Record and verify one render"). Update every doc that quotes `7a28332`.
   - Partner/API node (`api_node: true`, or matching `scripts/forbidden-nodes.json`): not allowed.
     Never edit `forbidden-nodes.json` to pass. Redesign with open nodes or stop and ask.
   - Custom node (a `custom_nodes/` package): unsupported. The image installs core only and the
     gate does not audit custom-node code. Stop and ask.
6. `npm run check:open-weights` → `<n> nodes scanned in <m> JSON files, 0 forbidden`.

## 3. Models

For each weights file the graph names (`workflowModelFiles`: loader fields `unet_name`,
`vae_name`, `clip_name`, `lora_name`, and any `*_name` field naming a `.safetensors`, `.ckpt`,
`.pt`, `.pth`, `.bin` or `.gguf` file), decide: does it fit `modelsLockSchema`?

- `file` `^[\w.-]+\.safetensors$`; `directory` one of `diffusion_models`, `loras`, `text_encoders`,
  `clip_vision`, `vae`; `license` `"Apache-2.0"`; `sha256` 64 hex
- `url` `https://huggingface.co/Comfy-Org/<repo>/resolve/<40-hex commit>/<directory>/<file>`

Anything else (another org or license, `checkpoints/`, `.gguf`, a gated repo): stop and ask; it
needs a reviewed schema change and a license review.

Write `src/features/<feature>/workflows/models.lock`, same shape as Motion Transfer's
(`{ "version": 1, "models": [{ "file", "directory", "url", "sha256", "license" }] }`). Commit,
license, SHA-256 and size come from Hugging Face's metadata:

```sh
REPO=Comfy-Org/<repo>
curl -fsS https://huggingface.co/api/models/$REPO/revision/main | jq -r '.sha, .cardData.license'
curl -fsS https://huggingface.co/api/models/$REPO/tree/<sha>/<directory> \
  | jq -c '.[] | {path, size, sha256: .lfs.oid}'
```

`lfs.oid` is the SHA-256 (also `x-linked-etag` of `curl -sI <resolve url>`); `size` is bytes. Then:

```sh
npm run check:models   # or: node scripts/check-models-lock.mjs src/features/<feature>/workflows/<id>.v1.json
# <feature>/<id>.v1: <n> model files, <n> locked, 0 missing   (one line per runtime workflow)
# <n> distinct model files across <k> feature locks, 0 conflicts   (only when every workflow passed)
```

A graph that loads no weights file needs no `models.lock`.

A `directory/file` another feature already pins must be copied with the identical `url` and
`sha256`. `npm run check:models` (and CI) aggregates every feature's lock and fails with
`Conflicting pins for <directory>/<file>: <featureA> and <featureB>` otherwise; `install-models.mjs`
applies the same rule at pod boot before any download. New recipes record
`lockedModels(graph, readModelsLock(<lock path>))`, as `motionTransferModels` does.

- **Cloud.** Its catalog is Comfy Cloud's; this repo cannot install a model there (the lock is an
  expectation there). The only proof is a real submit with the Cloud key, which spends credits
  (Motion Transfer: ≈17.5 per render, README "Credits"). Promise Cloud only after one succeeded.
- **Self-host.** Every pod boot installs and re-hashes the aggregate of all locks. Add the file
  sizes to the weights and disk/volume rows, and the measured peak VRAM to the GPU row, of
  `SETUP.md` "Sizing". One GPU runs one ComfyUI job at a time, so a pod must fit the largest
  feature's peak, not the sum. `IN_FLIGHT_MAX` (default 1) is app-wide.

## 4. Server path

- Params: `workflows/params.ts`, zod; file inputs typed `assetReferenceSchema`
  (`src/shared/server/comfy-assets.ts`); `Provider.upload(path)` returns an `AssetReference`.
- Graph: `WorkflowGraph` / `workflowGraphSchema` (`src/shared/server/workflow-graph.ts`). The
  inputs map and `buildGraph` stay per feature (MT's are keyed by MT params); if yours would be a
  copy, move the generic part to `src/shared/server/` instead.
- Registry: read the workflow once at module load from the working directory
  (`resolve("src/features/<feature>/workflows")`), check the inputs map's `workflow`, hash the
  workflow bytes for the recipe. Tooling finds it through `discoverWorkflows()`.
- Provider: `comfyProvider` from `src/shared/server/comfy-provider.ts`; take
  `provider: Provider = comfyProvider` so tests pass a double.
- Target: record `target: comfyTarget().kind` (`src/shared/server/comfy-target.ts`) in the recipe.
  Never read `COMFY_BASE_URL` or `COMFY_API_KEY` yourself.
- Recipe: a strict zod schema hashed canonically, like `server/recipe.ts`: input file SHA-256s,
  `models`, params without asset references, `target`, `workflow { id, sha256, version }`.
- Output: `job.getOutputs(<your output node>)`, stored with `storeAsset`
  (`src/shared/server/assets.ts`; `kind` is `video`, `image` or `poster`). Finalize for your
  media kind: an image is downloaded, hashed and stored as `kind: "image"`, with no poster and
  no FFmpeg. Never reuse MT's MP4 finalize. For video, MT's ffprobe helpers live in
  `server/media/probe.ts`; move them to shared rather than copy them.
- Uploads: 128 MiB per file (`MAX_UPLOAD_BYTES`, `src/shared/server/upload.server.ts`).
- RunPod's `*.proxy.runpod.net` closes connections after 100 s; the SDK falls back to polling.
  Treat `provider.job(id)` as the source of truth, not an unbroken event stream.

## 5. Packaging

Nothing to add: the app `Dockerfile` copies every `src/features/*/workflows` and `*/samples`, and
`selfhost/Dockerfile` every `src/features/*/workflows` (`COPY --parents`); `selfhost/entrypoint.sh`
installs the aggregate lock and preflights every runtime workflow. Confirm:

```sh
docker build --check .
docker build --check -f selfhost/Dockerfile .
docker build --platform linux/amd64 -t open-photon:local .
docker run --rm --entrypoint ls open-photon:local -R /app/src/features/<feature>
docker build --platform linux/amd64 -f selfhost/Dockerfile -t open-photon-comfy:local .
docker run --rm --entrypoint ls open-photon-comfy:local -R /opt/open-photon/src/features/<feature>/workflows
```

A file missing from a listing means a Dockerfile names features again: fix it generically, never
with a per-feature line. The app build typechecks first, so a stale `src/routeTree.gen.ts` fails.

## 6. Verification gate

All must pass before claiming the feature works on both targets. The dev machine has no GPU: an
unrun row is reported as "not verified on <target>", never as passing.

| Check | Expected |
| --- | --- |
| `npm run check` | exit 0 |
| `npm run test:server` (and `npm run test:e2e` for UI) | all pass |
| `npm run check:models` | your `<feature>/<id>.v1: … 0 missing` line |
| `npm run check:open-weights` | `… 0 forbidden` |
| `COMFY_BASE_URL= COMFY_API_KEY=<cloud key> npm run check:comfy` | `comfy target=cloud …`, `OK: reachable and authorized …` |
| `COMFY_BASE_URL=https://<pod-id>-8189.proxy.runpod.net COMFY_API_KEY=<PROXY_TOKEN> npm run check:comfy` | `comfy target=selfhost …`, `OK: …` |
| Pod from a `selfhost/` image built after your change | log has your `<feature>/<id>.v1: … 0 missing` line and `Serving the Comfy API v2 on 0.0.0.0:8189 (auth: bearer)` |
| One real render through the app on Cloud | done; recipe `target: cloud`; credits recorded |
| One real render on that pod | done; recipe `target: selfhost`; VRAM recorded with the `nvidia-smi` command in `docs/selfhost.md` |
| `DEPLOYMENT-QA-TEST.md` | the cases your change touches pass |

`scripts/verify-selfhost.mjs` checks Motion Transfer generations only; check your recipe's
`target`, workflow SHA-256 and model pins against your registry by hand. Then update `SETUP.md`
"Sizing" and add your row to the proof table in README "Open-weights checks and self-hosting".

## 7. Don'ts

- No per-feature `COMFY_BASE_URL`, key or provider client.
- No hand edits to `src/routeTree.gen.ts`, no `tsr`, no reordered `createFileRoute` option keys.
- No fallow suppression (unused exports, dupes); no `--fix` in `npm run check`.
- No copies of another feature's internals; no rows in `generations` from another feature.
- No partner/API or custom nodes; no widening `forbidden-nodes.json` or the lock schema without
  review; no Cloud or self-host claim without the real render on that target.

## Checklist

Paste [`checklist.md`](checklist.md) (beside this file) into your todo list before step 0.
