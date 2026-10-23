---
name: add-new-feature
description: Use when asked to add a feature, tool, ComfyUI workflow or model to open-photon; covers the feature layout, workflow and node rules, model pins, the server path, image packaging and the verification gate on both Comfy Cloud and self-hosted ComfyUI (RunPod).
---

# Add a feature to open-photon

One code path for both targets: Comfy API v2 through `@comfyorg/sdk`. `COMFY_BASE_URL` blank =
Comfy Cloud; any other URL = `selfhost` (ComfyUI behind `comfy-api-proxy`, built from `selfhost/`).
One target per app process, never per feature. Do the steps in order; write each step's decision
into your plan. "Stop and ask" = report what you found and ask the user; no workaround.

## 0. Read first, then decide whether the feature submits a job

Read `AGENTS.md` (binding), `docs/parallel-feature-foundation.md` (service contracts, recovery,
quota and request-key rules), `docs/priv/selfhost.md`, and the worked example
`src/features/characterBuilder/` (the second consumer of the generation service: a scalar-only
image workflow) beside the first, `src/features/motionTransfer/` (uploads, a video output with a
poster, the wizard).

Shared (import these, never copy them):

| Concern | Module |
| --- | --- |
| Workflow definition contract (`WorkflowDefinition`, `OutputDeclaration`, `recipeIdentitySchema`, `WorkflowRecipe`, the `workflows` registry) | `src/shared/server/generation/definition.ts` |
| Generation service (`submit`, `submitMany`, `retry`, `rerun`, `readGeneration`, `Admit`) | `src/shared/server/generation/service.ts` |
| HTTP answers and the request body (`answer`, `readInput` with the optional `request_key`) | `src/shared/server/generation/http.ts` |
| Errors (`GenerateError`) | `src/shared/server/generation/errors.ts` |
| Receipts, statuses, generation snapshots (`generationReceiptSchema`, `generationSchema`) | `src/shared/contracts.ts` |
| Runtime workflow loading (`loadRuntimeWorkflow`: graph, inputs map, SHA-256, model pins; `discoverWorkflows`) | `src/shared/server/comfy-workflows.ts` |
| API-format graph and binder (`workflowGraphSchema`, `inputsMapSchema`, `buildGraph`) | `src/shared/server/workflow-graph.ts` |
| Target (`comfyTarget`, `ProviderTarget`) | `src/shared/server/comfy-target.ts` |
| Provider (`comfyProvider`, `Provider`, `providerError`); fake (`fakeProvider`) | `src/shared/server/comfy-provider.ts`, `comfy-provider.fake.ts` |
| Uploaded-file reference (`assetReferenceSchema`, `AssetReference`) | `src/shared/server/comfy-assets.ts` |
| Model pins (`lockedModels`, `readModelsLock`, `aggregateModelsLocks`) | `src/shared/server/models-lock.ts` |
| Access rules (`PublicAccessDeclaration`, `createAccessPolicy`) | `src/shared/server/access-policy.ts` |
| Media (`cutPoster`, `probe`, `classifyImage`) | `src/shared/server/media/{poster,probe}.ts` |
| Assets, database, migrations, session, limits, uploads | `src/shared/server/{assets,db.server,migrate,access.server,limits,upload.server}.ts` |
| Characters (`createFromUpload`, `createFromGeneration`, `getCharacter`, `listCharacters`, `renameCharacter`, `setFavorite`) | `src/features/characters/api.ts` (server), `index.ts` (client) |
| Motion Transfer draft (`draftHref`, `parseDraft`, `snapshotDraft`, `withSeed`, `withCharacter`), slot props, fixtures | `src/features/motionTransfer/api.ts` |

**Decision A.** Does the feature submit a ComfyUI job?

- No: skip steps 2–3 and the render rows of step 6.
- Yes: it implements a workflow definition and submits through the generation service. There is
  no other path: a feature never writes its own submit, finalize, queue or `generations` access.
  The service gives it the in-flight cap (`IN_FLIGHT_MAX`, one count over every workflow: one
  `generations` table, one dispatcher), the waiting queue, idempotency keys, `unknown` handling,
  quota, rate limits, request keys, progress (SSE), recovery after a restart, output storage and
  `/g/:id`, `/r/:slug`, `/api/generations/:id[/events|/rerun|/retry|/recipe.json]`. If the
  contract cannot express the workflow (an output that is neither one image nor one MP4 video,
  several files from one node, a value no literal field takes), stop and ask; the change goes
  into `src/shared/server/generation/` for every workflow, not into the feature.

## 1. Feature skeleton

```text
src/features/<feature>/
  api.ts                  public server API for other features (only if they need one)
  index.ts                public client API for other features (only if they need one)
  contracts.ts            zod schemas + types for request/response bodies (client-safe)
  <name>.functions.ts     createServerFn; server modules via `await import("#/…")` inside handlers
  components/             React; imports with `#/`
  server/                 Node-only; relative imports with the `.ts` extension
    generate.ts           the entry that calls the service (characterBuilder: generateCharacter)
    public-access.ts      PublicAccessDeclaration (only if something is public)
    seed.ts               idempotent seeder (only if every database needs data)
    *.test.ts             node:test
  workflows/              <id>.v1.json, <id>.v1.inputs.json, models.lock, definition.ts,
                          defaults.json, README.md (provenance and smoke evidence)
  tests/                  *.test.ts (node:test), *.spec.ts (Playwright), fixtures.ts
  samples/                optional
src/routes/<path>.tsx     thin: imports from the feature and shared only
src/shared/server/migrations/<feature>/001-<name>.sql   only if the feature owns tables
```

- Everything under `server/`, `workflows/` or `tests/`, and what it imports, uses relative `.ts`
  imports (`npm run test:server` runs them in Node); client code uses `#/`.
- Composition, the one edit outside the feature: in `src/app/server.ts` add the definition to
  `workflows.compose([...])`, the declaration to `createAccessPolicy([...])`, the seeder to
  `seeders`; slot components go in `src/app/composer-slots.ts`. Nothing else registers a feature.
- Access: everything is private (needs the access-code session) unless a declaration makes it
  public. Server-function ids are `<source path>#<export>` in `publicServerFns`; routes are
  `publicRoutes` patterns; files are `isPublicAsset`. Public = an explicit line in the feature's
  `server/public-access.ts`. Moving a `*.functions.ts` file means updating its ids. Share pages,
  done outputs with a share page, and pre-rendered samples are already public through
  `src/shared/server/generation/public-access.ts`.
- Migrations: `src/shared/server/migrations/<feature>/001-<name>.sql`, then `002-…`; identity
  `<feature>/NNN`. Never add a flat `NNN-*.sql`, never edit an applied file (its checksum stops
  startup), never change another domain's tables (ask its owner). `shared/` migrations run
  before every other domain; domains run alphabetically after it.
- Another feature: import its `api.ts` (server) or `index.ts` (client), never its internals
  (`npm run check` fails: `scripts/check-import-boundaries.mjs`). A feature never imports
  `src/app/`. Fallow fails on unused exports and on copy-paste (`fallow dupes`): delete, or move
  the generic part to `src/shared/`.
- A feature that creates characters calls `createFromGeneration({ generationId, outputName,
  title? })` from a server function the user triggers after seeing the image (never on
  completion); it is idempotent per generation. Hand a character to Motion Transfer with
  `draftHref({ character, motion? })`.
- Routes: keep `createFileRoute(...)({ validateSearch, loaderDeps, loader, head, component })` in
  that order. API routes: `server: { handlers: { POST: ({ request }) => handleX(request) } }`
  (`src/routes/api.character-generations.ts`). `src/routeTree.gen.ts` regenerates on
  `npm run dev` or `vite build`; commit it. Route type assertions go in `tests/type-contracts.ts`.
- UI primitives: `npx shadcn@latest add <component>` (lands in `src/components/ui/`).
- Studio home card: `src/features/studio/components/studio-tools.tsx` (`upcoming`); there is no
  shared tool catalog.
- Tests live in the feature: `server/*.test.ts` or `tests/*.test.ts` (node:test; import
  `tests/temp-database.ts` first when the database loads, which also composes `src/app/server.ts`)
  and `tests/*.spec.ts` (Playwright, project `features`). End-to-end server tests run the real
  service on the fake provider (`process.env.COMFY_PROVIDER = "fake"`, `COMFY_FAKE_STEP_MS = "0"`;
  scenarios `success`, `provider_failed`, `ambiguous` by a `[fake:<scenario>]` marker in the graph),
  as `src/features/characterBuilder/server/generate.test.ts` does. Motion Transfer exports frozen
  draft and slot fixtures through its `api.ts` for other features' tests.

## 2. Workflow

1. Build it in ComfyUI at the pinned core: `ARG COMFYUI_COMMIT=7a28332047b6af638dc6c7f72ef3481a718769fd`
   (ComfyUI 0.42.0) in `selfhost/Dockerfile`.
2. Export in API format; save as `src/features/<feature>/workflows/<id>.v1.json`. Other files in
   `workflows/` (UI exports, `*.api.json` PoCs, nested provenance folders such as
   `motionTransfer/workflows/wan-animate-2/`) are not runtime workflows.
3. Write `<id>.v1.inputs.json` (shape of `character-generation.v1.inputs.json`):

   ```json
   {
     "workflow": "<id>.v1.json",
     "inputs": {
       "<param>": { "node": "<node id>", "field": "<input>", "class_type": "<class>" },
       "<param read by two nodes>": [
         { "node": "<node id>", "field": "<input>", "class_type": "<class>" },
         { "node": "<other node id>", "field": "<input>", "class_type": "<class>" }
       ]
     }
   }
   ```

   One entry per param, a single binding or a non-empty list when several nodes take the same
   value as a literal (Klein's `width`/`height` on `EmptyFlux2LatentImage` and `Flux2Scheduler`).
   Each field must exist and be a literal, not a `[node, slot]` link, and each class must match:
   the shared `buildGraph` (`src/shared/server/workflow-graph.ts`) throws otherwise. File inputs
   map to the loader's file field (`LoadImage.image`, `LoadVideo.file`). Where a template feeds a
   field from a `Primitive*` node, inline the value and drop the node
   (`characterBuilder/workflows/README.md`, "Flattening").
4. Declare the outputs in the definition, never as a constant: `outputs: [{ name, nodeId, media,
   poster? }]` (`OutputDeclaration`). `media` is `"image"` (PNG, JPEG or WebP, stored as
   downloaded) or `"video"` (MP4); `poster: true` on one video output also stores a JPEG still as
   the output `poster`. Names are unique and stored in `generation_outputs`; readers and share
   pages find files by them (Motion Transfer: `video` from `246` with a poster; characterBuilder:
   `image` from `78`).
5. Node classes, decide per class:
   - ComfyUI core at the pinned commit: fine. Check against a ComfyUI at that commit (a pod):
     `curl -fsS http://127.0.0.1:8188/object_info -o work/object-info.json`, then
     `jq -r '[.[].class_type] | unique[]' <workflow>` and `jq 'has("<Class>")' work/object-info.json`.
     On a pod with the weights installed, `node scripts/check-models-lock.mjs --definitions
     work/object-info.json` checks classes and files for every workflow.
   - Core, but only in a newer ComfyUI: stop and ask. A bump changes `COMFYUI_COMMIT` for every
     feature; every runtime workflow must pass again and the self-host proof is re-run
     (`docs/priv/selfhost.md`, "Record and verify one render"). Update every doc that quotes `7a28332`.
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
applies the same rule at pod boot before any download. New recipes record the pins
`loadRuntimeWorkflow` returns (`models`: `lockedModels(graph, <sibling models.lock>)`).

- **Cloud.** Its catalog is Comfy Cloud's; this repo cannot install a model there (the lock is an
  expectation there). The only proof is a real submit with the Cloud key, which spends credits
  (Motion Transfer ≈17.5 per render, a Klein character ≈0.25: `characterBuilder/workflows/README.md`).
  Promise Cloud only after one succeeded.
- **Self-host.** Every pod boot installs and re-hashes the aggregate of all locks. Record the
  file sizes and the measured peak VRAM (or "not measured" next to any guide figure) in the
  feature's `workflows/README.md`, and update the weights, disk/volume and GPU rows of
  `docs/priv/deployment.md` "Sizing". One GPU runs one ComfyUI job at a time, so a pod must fit
  the largest feature's peak, not the sum; the download and disk are the sum of every lock.

## 4. Server path

The worked example is `src/features/characterBuilder/` (`contracts.ts`, `workflows/definition.ts`,
`server/generate.ts`, `src/routes/api.character-generations.ts`); the contract and its rules are
in `docs/parallel-feature-foundation.md`.

- Input: a zod schema in `contracts.ts` (client-safe); file inputs are stored asset SHA-256s, not
  provider references.
- Workflow: `loadRuntimeWorkflow(resolve("src/features/<feature>/workflows/<id>.v1.json"),
  [<param keys>])` once at module load (working directory; both images keep the source paths).
  It checks the inputs map against the file and returns `graph`, `inputsMap`, `sha256`, `models`.
- Definition (`WorkflowDefinition<Input, Recipe>`, `src/shared/server/generation/definition.ts`),
  in `workflows/definition.ts`:
  - `id` (namespaced, e.g. `character-generation`), `version`, `workflowHash`, `models`.
  - `inputSchema`; `prepareRecipe(input, { target })` resolves defaults (sibling
    `defaults.json`), presets and the seed once and returns `{ recipe, characterId?, motionId? }`;
    it throws `GenerateError` for an input it refuses. Same choices → same recipe → same hash →
    the result is reused.
  - `recipeSchema`: strict; carries the shared identity (`recipeIdentitySchema`: `target` from
    `target.kind`, `workflow { id, version, sha256 }`, `models`) plus everything else that
    determines the output. Never credentials or provider references. The service refuses a
    recipe whose `workflow.id`/`version` is not the definition's.
  - `assetInputs(recipe)`: `{ <graph param>: <stored file sha256> }` to upload; `{}` for a
    scalar-only workflow (no upload, `provider_inputs` null).
  - `buildGraph(recipe, providerInputs)`: the shared `buildGraph(graph, inputsMap, values)`.
  - `outputs` (step 2.4), `seedOf`, `rebase(recipe, { seed, target })` (re-run keeps the seed,
    retry draws one; `null` when the workflow file changed), and `promptOf` if the recipe has a
    text prompt (a saved character's provenance reads it).
  - Register it: `workflows.compose([..., yourDefinition])` in `src/app/server.ts`. Duplicate
    `id`/`version` or unstorable outputs throw at startup. Bumping the workflow file = a new
    `<id>.v2.json` and version; old recipes must still decode.
- Entry (`server/generate.ts`): `submit(definition, input, { scope, admit, provider,
  requestKey })` → `GenerationReceipt` (`{ id, reused }`, or `{ id, reused, status: "waiting",
  position }` when it waits in line). HTTP: `answer(request, (session, admit) => …)` with
  `readInput(request, definition.inputSchema, maxBytes)`, which also reads the optional
  `request_key` (UUID): 201 submitted, 202 waiting, 200 reused, `GenerateError` statuses, 429.
  `scope: { session, free }` (`free` says which existing generations come back without a
  session; `() => false` unless the feature has free pre-rendered results).
- Many items in one request: `submitMany(definition, inputs, { scope, admit, requestKey })`
  (`requestKey` required) admits all or none: every item validated first (422 naming the item),
  quota checked for all new items at once (403 `code_exhausted`), all stored `waiting` with keys
  `<requestKey>#<index>`, one rate-limit token per request; reused items are free. Grouping and UI
  are the feature's.
- Status, progress, result and share pages, re-run, retry: the shared routes
  (`/api/generations/:id`, `/events`, `/rerun`, `/retry`, `/g/:id`, `/r/:slug`). The result and
  share views switch on output media.
- Provider: take `provider: Provider = comfyProvider` and pass it through, so tests pass
  `fakeProvider` or a double. Never read `COMFY_BASE_URL`, `COMFY_API_KEY` or `COMFY_PROXY_TOKEN`
  yourself; the target comes in `prepareRecipe`'s context.
- Uploads: 128 MiB per file (`MAX_UPLOAD_BYTES`, `src/shared/server/upload.server.ts`).
- RunPod's `*.proxy.runpod.net` closes connections after 100 s; the SDK falls back to polling.
  The dispatcher treats `provider.job(id)` as the source of truth, not an unbroken event stream.

## 5. Packaging

Nothing to add: the app `Dockerfile` copies every `src/features/*/workflows` and `*/samples`, and
the whole `src/shared/server/migrations` directory (namespaced subdirectories included);
`selfhost/Dockerfile` copies every `src/features/*/workflows` (`COPY --parents`);
`selfhost/entrypoint.sh` installs the aggregate lock and preflights every runtime workflow. Confirm:

```sh
docker build --check .
docker build --check -f selfhost/Dockerfile .
docker build --platform linux/amd64 -t open-photon:local .
docker run --rm --entrypoint ls open-photon:local -R /app/src/features/<feature> /app/src/shared/server/migrations
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
| `npm run check` (includes `lint:boundaries`) | exit 0 |
| `npm run test:server` (and `npm run test:e2e` for UI) | all pass, including the feature's own tests |
| Fake-provider server test of the feature's entry | submit → `done` with each declared output stored (fixture bytes), a `provider_failed` run, a 401 without a session |
| `npm run check:models` | your `<feature>/<id>.v1: … 0 missing` line |
| `npm run check:open-weights` | `… 0 forbidden` |
| `npm run build`, then `npm run check:client` | `Client secret check passed: …` (no `COMFY` name or build canary in `.output/public`) |
| `COMFY_BASE_URL= COMFY_PROXY_TOKEN= COMFY_API_KEY=<cloud key> npm run check:comfy` | `comfy target=cloud …`, `OK: reachable and authorized …` |
| `COMFY_API_KEY= COMFY_BASE_URL=https://<pod-id>-8189.proxy.runpod.net COMFY_PROXY_TOKEN=<PROXY_TOKEN> npm run check:comfy` | `comfy target=selfhost …`, `OK: …` |
| Pod from a `selfhost/` image built after your change | log has your `<feature>/<id>.v1: … 0 missing` line and `Serving the Comfy API v2 on 0.0.0.0:8189 (auth: bearer)` |
| One real render through the app on Cloud | done; recipe `target: cloud`; `generation_outputs` rows; `/g/:id`, `/r/:slug` 200; credits recorded in the feature's `workflows/README.md` |
| One real render on that pod | done; recipe `target: selfhost`; VRAM recorded with the `nvidia-smi` command in `docs/priv/selfhost.md` |
| `docs/priv/deployment-verification.md` | record the release checks your change touches |

`scripts/verify-selfhost.mjs` checks Motion Transfer generations only; check your recipe's
`target`, workflow SHA-256 and model pins against your definition by hand (the steps for
`character-generation.v1` are in `characterBuilder/workflows/README.md`, "Self-host"). Then
update `docs/priv/deployment.md` "Sizing" and the feature's `workflows/README.md` (provenance,
lock rationale, smoke evidence, what is not verified on which target).

## 7. Don'ts

- No per-feature `COMFY_BASE_URL`, key or provider client.
- No hand edits to `src/routeTree.gen.ts`, no `tsr`, no reordered `createFileRoute` option keys.
- No fallow suppression (unused exports, dupes); no `--fix` in `npm run check`.
- No copies of another feature's internals, no imports past its `api.ts`/`index.ts`; no
  `generations` rows written outside the service; no feature-owned submit, finalize, poll or queue.
- No flat `NNN-*.sql` migration, no edit to an applied one, no change to another domain's tables.
- No partner/API or custom nodes; no widening `forbidden-nodes.json` or the lock schema without
  review; no Cloud or self-host claim without the real render on that target.

## Checklist

Paste [`checklist.md`](checklist.md) (beside this file) into your todo list before step 0.
