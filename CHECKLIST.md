# Build checklist

One line per verified step of the [implementation plan](https://open-photon-docs.vercel.app/features/genjutsu/implementation-steps/), with the evidence that verified it.

## Phase 1 — The workflow as data

- [x] **1.2 Apply the audit's one-line fixes** — `compose.yaml` pins `platform: linux/amd64`; `tests/studio.spec.ts` fails on any `POST /api/jobs` from the whitespace-validation case. Commit `step 1.2`.
- [x] **1.3 Promote the workflow file to v1 and drop node 292** — `workflows/motion-transfer.v1.json`: 50 nodes, `has292 false`, `WanAnimate2ToVideo true`, `forbidden []`, `dangling refs 0`; SHA-256 recorded in `workflows/README.md`. Commit `step 1.3`.
- [x] **1.4 The inputs map** — `workflows/motion-transfer.v1.inputs.json`; the plan's Verify script prints `ok` for all 7 params, each with a literal value (`240.file`, `189.image`, `672:582.text`, `672:597.noise_seed`, `672:600.resize_type.width`/`.height`, `672:635.value`), exit 0.
