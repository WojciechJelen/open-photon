# Foundation for parallel feature development

Design proposal, 2026-10-22. Implementation has not started. This plan covers presets,
Explore/remix, look controls, batch variations, a character library, and character generation.

The objective is that each team can implement and verify its feature against a working,
stable base. Separate directories prevent textual conflicts only when the features also have
separate responsibilities and stable integration contracts.

## Grounding and constraints

The current path is `/api/generate` → Motion Transfer's `generate()` → recipe lookup and
admission → two asset uploads → one workflow graph → Comfy submission. Reads and event
streams reconcile provider status; finalization downloads node `246` as MP4 and makes a
poster. The recipe and generation-row parsers require Motion Transfer's inputs and params.
The current concurrency limit rejects excess work; it does not maintain a durable waiting list.

Relevant sources:

- `src/features/motionTransfer/server/{generate,generations,recipe,comfy,finalize}.ts`
- `src/features/motionTransfer/workflows/{registry,build-graph,params}.ts`
- `src/shared/server/db.server.ts` imports Motion Transfer's sample seeder and applies
  globally numbered migrations.
- `src/features/motionTransfer/server/public-access.ts` owns application-wide public access
  rules, including server-function source paths.
- `Dockerfile` explicitly packages only Motion Transfer's workflows and samples.
- `scripts/check-models-lock.mjs` defaults to one workflow and the root model lock.
- Server tests only match `tests/*.test.ts`; Playwright's test directory is `tests`.

Commit `11a0114` established the current feature/shared layout. Its recorded intent was to
keep feature-owned behavior together and feature-agnostic infrastructure in shared. The
proposed extraction follows that intent now that several features need the execution machinery.
The checkout also contains uncommitted self-hosting work in these areas; integrate that base
before relocating its files. Do not discard or independently reimplement it.

Preserve existing public URLs, historical recipes and their hashes, quota behavior where
unchanged, source-path server-function permissions, and the rule that an ambiguous provider
submission is not automatically repeated. Keep the existing oxc/tsgo/Fallow toolchain.

## Decision

Keep one application and SQLite database. Extract a small shared generation service; each
feature owns its validated inputs, workflow graph, output declaration, domain behavior, and UI.

The service owns the difficult common policies: admission, persisted waiting work, provider
submission, recovery, progress, output storage, and idempotency. A workflow definition owns
the meaning of its inputs and how they become a graph. Image and video processing live in
shared media utilities, selected by an explicit output declaration rather than a fixed node ID.

Keep characters as a domain feature with a narrow public API. Motion Transfer and the
character builder may consume that API; they do not directly query its tables. Shared assets
store media, while the character feature stores names, reference images, provenance and
likeness-consent information.

## Caller experience and contract sketch

The following is design pseudocode, not an implemented API:

```ts
// A feature's server entry point. The workflow carries its own input schema.
const receipt = await generations.submit(motionTransferWorkflow, input, {
  scope,
  requestKey,
});

// An image feature uses the same service and returns an image output.
const portrait = await generations.submit(characterImageWorkflow, input, {
  scope,
  requestKey,
});

// A batch owns group metadata; admission and execution use the same service.
const receipts = await generations.submitMany(workflow, inputs, {
  scope,
  requestKey,
});
```

The service resolves defaults and seeds once, validates every input with the selected
workflow's schema, checks input-asset access, and persists the resolved recipe before work
can run. Feature callers do not coordinate upload/submit/poll/finalize themselves.

Agree these contracts before teams branch:

| Contract | Required meaning |
| --- | --- |
| Workflow definition | Namespaced ID and version, input schema, deterministic recipe preparation, graph construction, input bindings, output node/media declarations, model pins. Server-only. |
| Generation receipt | Job ID and whether existing work was reused. Accepted waiting work is distinguishable from a job already submitted to Comfy. |
| Result | Named output assets with media kinds; image results do not need video fields or a fabricated poster. |
| Draft | Editable workflow reference plus feature-typed inputs. Browser/URL JSON is untrusted and validated against the selected workflow before use. |
| Recipe | Immutable resolved inputs, seeds, model/workflow hashes and target identity. Versioned decoding preserves old Motion Transfer recipes without rehashing them. |
| Scope | Server-resolved workspace and permissions; client input cannot select an arbitrary owner. |
| Character API | Create from upload or completed image generation; read/list permitted characters; rename and favorite through the domain owner. |

Prefer typed workflow definitions passed to the service. Any string-based lookup at HTTP or
worker boundaries must select a registered definition and validate with its schema. Avoid a
manually maintained union listing every feature in a shared business schema.

For `submitMany`, define one admission policy before implementation: validate the complete
request and reserve quota for all new items atomically, or reject it without partially admitting
the request. Record each item's stable request identity. Reused results do not consume a new
generation. Refund and failure rules must be shared with single submissions. Batch grouping,
variation choices, comparison UI and aggregate progress belong to the batch feature.

## Foundation work packages

### 1. Extract the execution and media services

- Move reusable provider transport, job persistence/state transitions, progress delivery,
  hashing and output storage into `src/shared`, with contracts outside server-only modules.
- Keep Motion Transfer validation, prompt construction, clip limits and graph inside its feature.
- Replace the fixed output node and MP4 assumption with declared named outputs.
- Add persisted waiting work and a scheduler that progresses without an open browser.
  Use transactional claims and recovery; an in-memory map alone is not a durable claim.
- Preserve the distinction between safe-to-retry failures and unknown submissions. Persist a
  non-secret provider target identity so restart/recovery cannot ask a different endpoint about
  an existing job. Credentials stay in environment configuration.
- Adapt existing endpoints and result views to the service while preserving their public behavior.

### 2. Settle ownership and publishing

Recommended initial scope: one workspace per installation, accessed through the existing
codes. This preserves the current shared-access product model and supports a workspace
character library without introducing a new login product. Distinct private user libraries would
require a different scope policy before implementation.

- Keep physical byte deduplication separate from ownership and visibility. Identical file hashes
  do not themselves grant access to another scope's asset.
- Make published results reference exactly the assets that are public. A public result must not
  automatically expose every source image or upload used in its recipe.
- Put access-policy enforcement in shared; keep explicit public route/function declarations with
  their feature. Compose them at application startup, defaulting to private.
- Move character contracts/repository into a `characters` feature before its consumers branch.
  Define idempotent creation from a completed image generation, so a retry cannot create copies.
- Preserve existing published-link behavior through an explicit compatibility migration/policy.

### 3. Establish integration points before teams edit the wizard

Three teams otherwise compete for `direct-step.tsx`, `result-view.tsx` and
`motion-transfer-wizard.tsx`. Make these integration points explicit in the foundation:

| Team | Boundary it consumes/publishes |
| --- | --- |
| Presets | A preset expands into a validated draft: selected motion, optional character, direction and settings. Explicitly declare which inputs the user must supply. |
| Explore/remix | Published-result summaries and a public remix-to-draft operation; the receiving feature validates asset access and input compatibility. |
| Looks | A controlled direction editor: value plus change callback. It updates draft direction; it does not submit a graph. Resolve preset versions/phrases into the recipe. |
| Batch | A controlled generation-action component receiving an immutable draft snapshot; produces variants and submits through the shared service. |
| Characters | Stable picker/read/write API; library presentation and collections remain feature-owned. |
| Character builder | Image generation followed by idempotent character creation; returns a character ID that Motion Transfer already accepts. |

Use ordinary components and explicit composition. The foundation installs the seams once;
an integration owner mounts completed components. A feature can test its component against
the frozen props and fixtures without waiting for the neighboring feature to finish.

### 4. Remove repository-wide registration bottlenecks

- Each feature publishes separate client-safe tool metadata and server workflow/policy metadata.
  Use a deterministic build-time composition step for predictable files; validate duplicate IDs.
  Keep a small explicit application composition point for UI wiring. Server workflow code must
  never enter the client catalog or bundle.
- Keep migrations under the existing `src/shared/server/migrations` location, with owned
  subdirectories such as `characters/001-library.sql` and `batches/001-batches.sql`. Extend the
  runner to identify new migrations by namespace and version, preserving the applied legacy
  `001`–`007` history. Track checksums and reject edits to applied migrations.
- Apply the shared foundation schema first. Feature migrations may depend on that baseline
  and earlier migrations in their own namespace. Cross-feature schema changes go through
  the owning team, rather than relying on accidental alphabetical order.
- Separate database opening/migration from feature seeding. Compose idempotent seeders at
  startup; feature tests opt into their own fixtures.
- Put model pins beside each feature's workflows. Shared tooling discovers and checks all
  manifests, aggregates installation requirements, and fails conflicting destination/hash pins.
  Historical recipe pins remain unchanged. The open-weights checker already scans all features.
- Package every declared runtime workflow, sample and migration automatically. Test the built
  image so a feature cannot pass locally while missing its files in production.

### 5. Make independent development real

- Add feature-local test discovery once: server tests, browser tests and type contracts. Preserve
  `tests/type-contracts.ts` and support all server imports with relative `.ts` paths.
- Provide a deterministic fake provider with actual image/video fixture outputs, progress,
  failure and ambiguous-submission scenarios. Keep it explicitly isolated from production.
- Provide feature-local fixture builders and seeders, avoiding a shared seed file edited by every team.
- Preserve per-test temporary databases; give each worktree its own database/assets, browser
  storage, dev/E2E ports, Compose project name and volume. Parameterize fixed ports.
- Real GPU checks use separate endpoints or a coordinated shared queue. Separate worktree
  databases do not enforce a common GPU concurrency limit. Provision workflow models and
  nodes through one infrastructure owner; feature teams declare their requirements.

## Ownership after the foundation lands

Proposed feature directories: `presets`, `explore`, `looks`, `batches`, `characters`,
`characterBuilder`, with `motionTransfer` retaining its existing product flow.

Each team owns its feature directory, distinct route source files and its migration namespace.
Shared contracts have one owner; additive changes are preferred after the initial split.

The foundation/integration owner manages shared infrastructure, global CSS/design tokens,
shadcn primitives, dependency/configuration changes, app composition and deployment tooling.
Install agreed UI primitives once with `npx shadcn@latest add ...`; teams use the shared
versions. New dependencies remain possible but are coordinated small changes.

Enforce import boundaries in CI using the existing toolchain or a focused check: no imports
of another feature's internals; approved public feature APIs are allowed; shared infrastructure
does not import feature implementations. Only the application composition boundary connects
implementations. Keep client and server entry points separate. CODEOWNERS/review ownership
can route changes, but automated checks enforce the actual boundaries.

Every team branches from the same integrated foundation commit, using `codex/<feature>`
unless a different branch name is requested. Merge small working slices regularly. Avoid
formatting or refactoring unrelated directories on a feature branch.

`src/routeTree.gen.ts` remains a shared generated artifact. Each route change commits its
generated tree as required. After merging route sources, regenerate through the Vite/TanStack
Start plugin and then typecheck; do not hand-merge the tree or use `tsr`. Because `npm run build`
starts with typechecking, route regeneration must happen before invoking that script if the
committed tree is stale. Keep `npm run check` read-only.

## Alternatives considered

1. **Feature-owned execution pipelines sharing only Comfy transport/assets.** This hides less
   complexity from each team: every caller must implement admission, ambiguous submissions,
   retries, progress and recovery. It reduces a few code conflicts but creates behavioral drift
   and makes batch orchestration depend on several different lifecycles.
2. **Shared execution service with feature-owned workflow behavior — selected.** One interface
   hides execution and recovery policies while preserving feature-specific inputs and UX. The
   initial extraction is bounded and can be proven with two workflows.
3. **A universal plugin/editor platform.** This requires speculative schemas for forms, editing,
   execution and extensions. The known features only need narrow contracts and ordinary
   composition. Accept a few owned integration points instead.

This synthesis compares two independent read-only code reviews with the repository trace.
The architect skill's referenced arena skill was not available in the installed skill directories;
the reviews used the available agent mechanism rather than that runner.

## Build order and release gate

1. Integrate the current self-hosting changes and capture compatibility fixtures.
2. Land shared contracts, ownership policy, character API and wizard integration boundaries.
3. Extract the working runtime; migrate Motion Transfer; prove a minimal image workflow too.
4. Add durable scheduling, per-feature resource/migration discovery and development fixtures.
5. Verify the assembled foundation, record its commit, then split feature implementation branches.

Teams can prepare examples, workflow experiments and isolated UI while this lands. Product
branches should share the verified base before depending on the new services.

The foundation is ready when:

- [ ] Motion Transfer works through it and historical recipes/results/links remain usable.
- [ ] A minimal image workflow completes through the same service; adding it needs no
  Motion Transfer internal edits or image-specific branch in the shared job state machine.
- [ ] Multiple jobs wait beyond capacity, survive restart, settle individual failures and avoid
  duplicate submission or quota charges on repeated requests.
- [ ] A feature can add its workflow, tests, data, route and migration using owned files, with
  only the documented application composition step needed for integration.
- [ ] Anonymous/public/private behavior and explicitly published source assets are verified.
- [ ] Two worktrees run their server/browser tests simultaneously without state or port collisions.
- [ ] Model checks, open-weights checks, `npm run check`, server/browser tests and packaged
  runtime verification pass on the integrated base. Real image/video smoke renders establish
  backend compatibility; fake-provider tests alone do not establish output quality.

Next implementation step: after the current self-hosting work is integrated, extract the provider
and job contracts and migrate Motion Transfer as their first consumer, preserving its behavior.
