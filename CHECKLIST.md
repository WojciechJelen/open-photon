# Build checklist

One line per verified step of the [implementation plan](https://open-photon-docs.vercel.app/features/genjutsu/implementation-steps/), with the evidence that verified it.

## Phase 1 — The workflow as data

- [x] **1.2 Apply the audit's one-line fixes** — `compose.yaml` pins `platform: linux/amd64`; `tests/studio.spec.ts` fails on any `POST /api/jobs` from the whitespace-validation case. Commit `step 1.2`.
- [x] **1.3 Promote the workflow file to v1 and drop node 292** — `workflows/motion-transfer.v1.json`: 50 nodes, `has292 false`, `WanAnimate2ToVideo true`, `forbidden []`, `dangling refs 0`; SHA-256 recorded in `workflows/README.md`. Commit `step 1.3`.
- [x] **1.4 The inputs map** — `workflows/motion-transfer.v1.inputs.json`; the plan's Verify script prints `ok` for all 7 params, each with a literal value (`240.file`, `189.image`, `672:582.text`, `672:597.noise_seed`, `672:600.resize_type.width`/`.height`, `672:635.value`), exit 0.
- [x] **1.5 `buildGraph` and its tests** — `src/server/workflows/{params,build-graph,registry}.ts`; `tests/build-graph.test.ts` covers the five plan cases against `tests/fixtures/spike-submitted-graph.json` (written once by a `WAN_DRY_RUN=1` mode of `scripts/run-wan.mjs` calling the spike's `prepareWanWorkflow` with stand-in asset references; the mode and `src/server/wan-workflow.server.ts` were then removed, and the app's submit path now uses `loadWorkflow` + `buildGraph`). `npm run test:server`: 24 pass (19 + 5), 0 fail; `npm run check` exit 0; `grep -nE "@comfyorg|node:fs" src/server/workflows/build-graph.ts` prints nothing. Dead-port check on `127.0.0.1:3031` (`COMFY_BASE_URL=http://127.0.0.1:1`): `POST /api/jobs` → `failed`, stage `prepare-inputs`, no provider job; Playwright 3 pass, 1 skip.
  - v1's SaveVideo `246` is pinned to MP4/H.264 (the spike set it per job); new SHA-256 in `workflows/README.md`.
