# Foundation for parallel feature development

Design record of the shared foundation (DEV-288, built as DEV-295 to DEV-298) that lets six teams
build presets, Explore/remix, look controls, batch variations, a character library and character
generation on separate branches. It describes the code as it is; every path below exists.
The binding rules are in `AGENTS.md`; the step-by-step process for a new feature or workflow is
`.claude/skills/add-new-feature/SKILL.md`.

## Decision

One application, one SQLite database, one process per installation. A small shared generation
service (`src/shared/server/generation/`) owns everything that is hard to get right more than
once: admission, quota, rate limits, idempotency, the waiting queue, provider submission,
recovery after a restart, progress, output storage, and result/share pages. Each feature owns a
workflow definition (what its inputs mean and how they become a graph), its domain behavior and
its UI. Media handling is selected by each output's declaration, not by a fixed node id.

Characters are a domain feature (`src/features/characters/`) with a narrow public API. Motion
Transfer and the character builder use that API; they do not query its table. Shared assets
store bytes; the characters feature stores names, images, provenance and likeness consent.

Alternatives considered: feature-owned pipelines sharing only Comfy transport (every caller
re-implements admission, ambiguous submissions, retries and recovery, and batches would depend
on several lifecycles), and a universal plugin/editor platform (speculative schemas the known
features do not need). The shared service with feature-owned workflow behavior was selected and
proven with two workflows: Motion Transfer (uploads, one MP4 with a poster) and character
generation (scalar inputs, one PNG).

## Contracts as implemented

### Workflow definition

`WorkflowDefinition<Input, Recipe>` in `src/shared/server/generation/definition.ts`, server-only,
one per workflow version, owned by its feature (`src/features/motionTransfer/workflows/definition.ts`,
`src/features/characterBuilder/workflows/definition.ts`):

| Member | Meaning |
| --- | --- |
| `id`, `version` | Namespaced id (`motion-transfer`, `character-generation`) and integer version; stored as `generations.workflow_id`/`workflow_version`. |
| `workflowHash`, `models` | SHA-256 of `<id>.v<N>.json` and its pins from the sibling `models.lock` (`loadRuntimeWorkflow`, `src/shared/server/comfy-workflows.ts`). |
| `inputSchema` | zod schema of the request body. |
| `prepareRecipe(input, { target })` | Resolves defaults, presets and the seed once into an immutable recipe (`PreparedRecipe`: `{ recipe, characterId?, motionId? }`); throws `GenerateError` to refuse an input. |
| `recipeSchema` | Strict schema decoding every recipe this version stored. Every recipe carries `recipeIdentitySchema` (`target`, `workflow { id, version, sha256 }`, `models`); the type is `WorkflowRecipe`. `hashRecipe` refuses a recipe naming another workflow before hashing. |
| `assetInputs(recipe)` | Stored files (by SHA-256) to upload, keyed by graph param; `{}` for a scalar-only workflow, which submits without an upload and stores no `provider_inputs`. |
| `buildGraph(recipe, providerInputs)` | The API graph; both workflows use the shared binder `buildGraph(graph, inputsMap, values)` (`src/shared/server/workflow-graph.ts`). An inputs-map entry is one binding or a non-empty list of bindings (`inputsMapSchema`); every binding must name a node of its `class_type` and a literal field. |
| `outputs` | `OutputDeclaration[]`: `{ name, nodeId, media: "image" \| "video" \| "text", poster? }`. One asset per name; at most one `poster`, on a video. |
| `seedOf`, `rebase(recipe, { seed, target })` | The recipe's seed, and the recipe a re-run (same seed) or retry (new seed) renders on the current target; `null` when the workflow file changed. |
| `promptOf` (optional) | The text prompt, read as provenance when a generated character is saved. |
| `shareRecipe` (optional) | What the public share page `/r/:slug` (`readGenerationShare`) shows of the recipe; without it, the stored recipe. The character image leaves out the enhanced caption, a private text output. |

The registry is `workflows` in the same file: `src/app/server.ts` sets the composed definitions
with `workflows.compose([...])`; tests add theirs with `workflows.register`. Duplicate
`id`/`version` pairs and unstorable output declarations throw. A stored generation finds its
definition again by `(workflow_id, workflow_version)`.

### Generation service

`src/shared/server/generation/service.ts`:

- `submit(definition, input, { scope, admit?, provider?, requestKey? })` → `GenerationReceipt`.
- `submitMany(definition, inputs, { scope, admit?, provider?, requestKey })` →
  `GenerationReceipt[]`: all items or none (see "Quota, refunds and rate limits").
- `retry(id, session)`, `rerun(id, session)`: `POST /api/generations/:id/retry` (a failed or
  cancelled parent, new seed; never an `unknown` one, 409) and `/rerun` (same seed; a done
  generation of the same recipe comes back free).
- `readGeneration(id)`: `GET /api/generations/:id`.

`scope` is `{ session, free }`: one workspace per installation, reached through the
access-code session, which pays for new rows; `free` says which existing generations come back
without a session (Motion Transfer's pre-rendered samples). `admit` is the rate limit the HTTP
layer passes. `src/shared/server/generation/http.ts` turns a request into a call: `readInput`
validates the body against the definition's `inputSchema` and reads the optional `request_key`
(a UUID); `answer` maps the receipt to 201 (submitted), 202 (waiting), 200 (reused) and
`GenerateError` to its status. `stream.ts` serves `/api/generations/:id/events` (SSE), a view over
the row; `pages.ts` reads `/g/:id` and `/r/:slug` for any workflow, switching on output media.

Client-safe contracts are in `src/shared/contracts.ts`:

- `generationReceiptSchema`: `{ id, reused }`, plus `status: "waiting"` and `position` when the
  generation waits in line.
- `generationStatusSchema`: `waiting → preparing → queued → running → finalizing → done`, or
  `failed`, `unknown` (the provider may have the job; never resubmitted), `cancelled` (a waiting
  row taken out of line).
- `generationSchema` (a snapshot with `position` while waiting, and `outputs` once done) and the
  error codes, including `target_mismatch`. `outputs` (`GenerationSnapshotOutput[]`, by name) is
  every named output of a done generation: a file as `{ name, media: "image" | "video" |
  "poster", asset }`, a text inline as `{ name, media: "text", text }`; `[]` in any other status.
  `GET /api/generations/:id` and every event-stream snapshot carry it, so a client needs no
  other read to show a result. `useLiveGeneration(initial)` (`src/shared/use-live-generation.ts`)
  follows a generation's stream for any feature.

### Named outputs and publishing

`shared/001-generation-outputs.sql` adds `generation_outputs (generation_id, name, asset_id)`,
backfilled from `final_asset_id` (`video`) and `poster_asset_id` (`poster`); those columns keep
mirroring the two Motion Transfer outputs. `finalize.ts` downloads each declared output: an image
is stored as downloaded (`kind: "image"`, no FFmpeg), a video as an MP4, and a `poster: true`
video also gets a JPEG still at 0.5 s (`src/shared/server/media/poster.ts`).

A `text` output is a text file the node saved: core `SaveText` (format `txt`). Comfy's jobs API
(`GET /api/v2/jobs/:id`, Cloud and the self-host proxy alike) lists it as a `.txt` file (`type:
"file"`, no content type); it does not list a `PreviewAny` node's text (measured by DEV-297 on
Cloud). Finalize takes the node's outputs of type `text`, a `text/*` content type or a `.txt`
name, downloads them in order and stores the first that is not blank byte for byte as a `kind:
"text"` asset (`role: "provider_output"`, `text/plain; charset=utf-8`, `<sha256>.txt`;
`shared/004-text-assets.sql` widens `assets.kind`). One that is not UTF-8 or longer than
`TEXT_OUTPUT_MAX_BYTES` (16 KiB), or none that is not blank, fails the generation at once
(`provider_failed`, no finalize retries). The fake provider answers a `SaveText` node with
`tests/fixtures/fake-output.txt`.

A done generation gets a `share_slug` (`/r/<slug>`) unless every output it stored is a text.
`generationAccess` (`src/shared/server/generation/public-access.ts`) makes public: share pages,
exactly the file outputs of done generations that have a share page (`isSharedOutput`; a text
asset never is), and the pages and API of pre-rendered samples. `readOutputs` (what `/g/:id`,
`/r/:slug` and `createFromGeneration` read) returns file outputs only, so a text-only generation
has no share page and shows no output on its result page. Inputs are not public through it:
Motion Transfer's declaration adds the source clip its share page shows; uploaded character
images stay private. Every `/r/<slug>` and `/media/<id>.<ext>` URL that existed before the
backfill still answers.

An image a workflow produces is disclosed as AI-generated wherever it is shown (the FLUX
Kommunity licence asks for it): `GeneratedImage` (`src/shared/components/`) shows an image output
on `/g/:id` and `/r/:slug` with an "AI-generated image" label, alt text that says so (also the
share card's `og:image:alt`) and Download, and `?download=1` names an image output
`ai-generated-<id>.<ext>`. Anything else keeps `open-photon-<id>.<ext>`, Motion Transfer's
videos and posters included. Neither shows a recipe's enhanced caption.

### Provider target identity

`generations.target` (`cloud | selfhost`) plus `target_origin` (the self-host proxy's origin,
null on Cloud; never credentials) record where a job was submitted. A row whose endpoint differs
from the one the server renders on now is never asked about: `queued`/`running`/`finalizing`
fail `target_mismatch` (`failElsewhere`, `finalize.ts`), `waiting` rows are cancelled at boot.
The in-flight count only counts rows of the current endpoint.

### Migrations

`src/shared/server/migrate.ts` runs `src/shared/server/migrations/` when `db.server.ts` opens the
database. The flat `001`–`007` files are frozen and recorded as `legacy/NNN` (an existing
`migrations` table is upgraded in place under the write lock). New migrations live in
`<domain>/NNN-name.sql` with identity `<domain>/NNN`. Order: `legacy`, `shared`, then other
domains alphabetically, numeric within one. The file's SHA-256 is recorded; a changed applied
file stops startup. Foreign keys are not enforced while migrating, so a migration may rebuild a
table others point at (`shared/002-waiting-queue.sql`). Applied today: `shared/001`
(outputs, `target_origin`, `submit_started_at`), `shared/002` (waiting queue), `shared/003`
(`generation_requests`), `shared/004` (`assets.kind` `text`), `characters/001` (library columns,
one character per generation).

### Access policy and seeders

`src/shared/server/access-policy.ts`: `createAccessPolicy(declarations)` over each feature's
`PublicAccessDeclaration` (`publicServerFns` keyed `<source path>#<export>`, `publicRoutes`,
`isPublicAsset`, `indexableRoutes`, `isIndexableAsset`). Anything undeclared needs the access
code. Declarations: `src/shared/server/generation/public-access.ts`,
`src/features/{motionTransfer,characters,studio}/server/public-access.ts`.

Seeders are idempotent functions a feature exports (`seedSampleCharacters`,
`seedSampleMotions`); `seedDatabase()` in `src/app/server.ts` runs each in its own transaction at
boot (`src/app/boot.ts`) and in `scripts/seed-samples.mjs`, `tests/temp-database.ts` and
`tests/e2e/seed.ts`.

### Characters

`src/features/characters/api.ts` (server) and `index.ts` (client: `characterSchema`,
`characterSummarySchema`, `CharacterSummary`, `PickableCharacter`, `characterTitleSchema`,
`characterListQuerySchema`, `characterListSchema`). Policy: a workspace library; every
non-sample character is visible to whoever holds a session; there is no per-user owner.

- `createFromUpload({ assetId, consentAt, title? })`.
- `createFromGeneration({ generationId, outputName, title? })`: a user action after seeing the
  image, never called on completion. The generation must be `done` with an image output of that
  name; prompt and provenance come from the stored recipe (`readGenerationProvenance`,
  `promptOf`). Idempotent per generation (`characters_generation` unique index): a second call
  returns the first character with `created: false`. A rerun or retry is another generation.
- `getCharacter`, `listCharacters({ includeSamples })`, `listSampleCharacters`,
  `visibleCharacter`, `renameCharacter`, `setFavorite`; errors are `CharacterError` with a status.
- HTTP: `POST /api/characters` (upload with consent), `PATCH /api/characters/:id` (title,
  favorite; a sample's title is refused with 409). Both need a session. `GET /api/characters`
  (DEV-293; session, else 401): query `characterListQuerySchema` (`q`: title or prompt
  substring, case-insensitive; `favorites=1`; `samples=0` leaves samples out), answer
  `characterListSchema` `{ characters }`, most recent first (`created_at` descending, then `id`).

### Character builder

`src/features/characterBuilder/index.ts` (client) exports the contracts of `contracts.ts`
(FLUX 3 Image Klein distilled, DEV-294/DEV-297):

- `characterControlsSchema` (`appearance`, `outfit`: trimmed, ≤200, blank is none; `style`:
  `characterStyles`, `realistic | stylized-3d | illustration | anime`) and
  `compileCharacterRequest(description, controls)`: pure; the description as a sentence, each
  control, then `CHARACTER_FRAMING` (one person, full body head to toe with hands and feet, neutral
  standing pose, plain background, even light). The server recomputes it; a client never sends it.
- `POST /api/character-captions`, `characterCaptionInputSchema` (`description` 1–1000 trimmed,
  `controls?`, `seed?`) plus `request_key?`: the upsampler-only `character-caption` workflow
  (`CHARACTER_CAPTION_WORKFLOW`), one text output `caption` (`CAPTION_OUTPUT`).
- `POST /api/character-generations`, `characterGenerationInputSchema` (`caption` 1–4000, not
  blank, byte-exact; `seed?`, `width?`/`height?` via `imageSideSchema`; `source?: { description?,
  controls?, caption_generation_id? }`) plus `request_key?`: `character-generation`
  (`CHARACTER_GENERATION_WORKFLOW`), one image output `image` (`IMAGE_OUTPUT`). With
  `caption_generation_id` (a done caption generation, else 404/409) the server copies the
  description, controls and enhancement provenance and records `edited`; without it the
  provenance is the client's `description`/`controls` and `enhancement: null`. Both endpoints
  answer `generationReceiptSchema` like `POST /api/generate`.
- `POST /api/character-generations/:generationId/character`, `saveCharacterInputSchema`
  (`title?`; a JSON body is required, `{}` for no title): `createFromGeneration` of the `image`
  output; 201 new / 200 existing `CharacterSummary`, 400 `invalid_input` for a missing, invalid or
  oversized body (nothing saved), 401, 404, 409. Only an explicit user action calls it.
- Fixtures (`tests/fixtures.ts`): `captionInputFixture`, `captionGenerationFixture` (text output),
  `enhancedCaptionFixture`, `generationInputFixture`, `imageGenerationFixture` (image output),
  `savedCharacterFixture`, `captionGenerationId`, `imageGenerationId`.

The definitions implementing them are `workflows/caption-definition.ts`
(`character-caption.v1`, the FLUX 3 prompt upsampler) and `workflows/definition.ts`
(`character-generation.v1`, FLUX 3 Image Klein distilled; its `shareRecipe` leaves the enhanced
caption off the public share page). FLUX.2 is gone: no fallback, no legacy recipe.

### Motion Transfer draft and composer slots

`src/features/motionTransfer/api.ts` exports the draft contract (`draft.ts`):
`motionTransferDraftSchema` (`step`, `motion`, `character`, `from`, `angle`, `prompt`, `seed`;
`prompt: ""` clears the look, `seed: "default"` resets the seed), `parseDraft` (never throws,
drops invalid members), `draftHref(draft)` (the `/motionTransfer?…` link), `snapshotDraft`,
`withSeed`, `withCharacter`, `defaultDirection`, `carriedDraft`, `carryDraft`, and test fixtures
(`draftFixture`, `snapshotFixture`, `directionFixture`, `sampleCharacterId`, `sampleMotionId`).
The wizard owns its URL; another feature opens it with `draftHref`, never by holding its state.
"Animate this character" is `draftHref({ character: id, motion? })`: with a motion it opens on
Direct, without one on motion selection.

Carrying the draft through another page (the library `/characters`, the builder
`/characters/new`): the link carries the shot in one search member, `draft`, a JSON object
(`carryDraft(draft)` → `{ draft }`, or `{}` when there is nothing to carry); the page declares
`draft: carriedDraft(search.draft)` in `validateSearch` (validated like `parseDraft`, without
`step` and `character`, frozen, `undefined` when empty; never throws); "Animate" returns with
`draftHref(withCharacter(draft ?? {}, id))`, keeping the motion and the direction.

Slots (`src/features/motionTransfer/slots.ts`): `characterPicker` (`CharacterPickerProps`:
`characters` the loader has, `character`, `characterId`, `onPick`, `hold`, `release`,
`signedIn`, and `draft`, the shot without its character, for links that carry it),
`directionEditor` (`DirectionEditorProps`: `value`, `onChange`), `directGenerationActions`
(`DirectGenerationActionsProps`) and `resultGenerationActions` (`ResultGenerationActionsProps`),
both receiving an immutable `DraftSnapshot`. Defaults: `DefaultCharacterPicker` (the upload tile,
the visitor's own photo and the samples; the Character step keeps its intro and tips around the
slot), `DefaultDirectionEditor`, `GenerateButton`, `RerunButton`. They are filled in one place,
`src/app/composer-slots.ts`, which mounts the library's `LibraryCharacterPicker` in
`characterPicker` and gives it and the library page (`/characters`) `createCharacterHref`: the
builder, `/characters/new`, carrying the draft. The studio (`/`) links Motion Transfer and both
character tools ("Describe a character", "Character library"); the main navigation's Image ›
Create character and Library › Characters open them.

### Import boundaries

`scripts/check-import-boundaries.mjs` (in `npm run check`): `src/shared/**` and `src/start.ts`
never import a feature; a feature imports another only through its `index.ts` or `api.ts`; a
feature never imports `src/app/**`; `src/app/**` and `src/routes/**` may import anything.

## Adding a feature: the composition step

A feature lives in `src/features/<feature>/` (code, `workflows/`, `samples/`, `tests/`), its
routes in `src/routes/`, its tables in `src/shared/server/migrations/<feature>/`. The only
edits outside those are:

1. `src/app/server.ts`: its workflow definition in `workflows.compose([...])`, its
   `PublicAccessDeclaration` in `createAccessPolicy([...])`, its seeder in `seeders`.
2. `src/app/composer-slots.ts`: a component that fills a Motion Transfer slot.
3. `src/routeTree.gen.ts`, regenerated by `npm run dev` or `vite build` (never `tsr`).

Nothing else registers it: workflow discovery, model checks and installation, image packaging,
test discovery and migrations pick it up from its location. The character builder's
registration was one line in `workflows.compose` and nothing else (no seeder, nothing public).

## Admission, queue and restart recovery

From `src/shared/server/generation/dispatcher.ts`:

The dispatcher: one per server process (`src/app/boot.ts` starts it after seeding, and stops it
when the server closes), so generations progress with no browser connected and after a restart.

- **Admission.** A request admits a new generation at once (`preparing`, submitted inside the
  request) while a place in flight is free (`IN_FLIGHT_MAX` bounds `preparing..finalizing`) and
  nobody waits in line; otherwise it stores it `waiting` and answers 202 with its place in line
  (`submit`, `submitMany` in `service.ts`). A `waiting` row has no provider job and holds its
  access code's count.
- **Claims.** On each wake (a row joined the line or changed status, `onQueueChange`) and every
  `GENERATION_DISPATCH_MS` (default 3000), while fewer than `IN_FLIGHT_MAX` generations are in
  flight on the endpoint this server renders on, it takes the oldest `waiting` row for that
  endpoint (`claimNextWaiting`: one `BEGIN IMMEDIATE` transaction, `waiting → preparing`,
  `claimed_at`, `claimed_by` = this process) and submits it as a request would (`sendClaimed`:
  upload, build, submit, `markQueued`).
- **Progress.** Every `GENERATION_DISPATCH_MS` it asks the provider about each `queued`,
  `running` or `finalizing` row (`finalize`, with its backoff after a failed download), so a
  finished job is collected and its place freed whether or not anyone watches its event stream,
  which stays a view over the row. One finalize per row at a time; a row whose poll fails
  (the provider unreachable) is asked again after a capped, jittered exponential backoff, which
  counts no download attempt and refunds nothing.

Restart recovery (`recoverAfterRestart`, run once at boot before the dispatcher starts; one
process runs per installation, so every claim found then is a stopped process's):

- `waiting`: stays in line, in its place (`created_at`), and the dispatcher submits it. One
  whose recipe was resolved for another endpoint than the one this server renders on now
  (`target`, `target_origin`) can never be submitted here: it is `cancelled`
  (`target_mismatch`), which gives its access code's count back.
- `preparing` with no `submit_started_at`: the graph never reached the provider, so it goes back
  to `waiting` (`releaseClaim`: unclaimed, its place and count kept) and is submitted again,
  under the same idempotency key.
- `preparing` with `submit_started_at`: the provider may have the job, so it becomes `unknown`
  and is never resubmitted; its count is not given back.
- `queued`, `running`: left as they are, for the dispatcher's first poll to ask the provider
  about (`finalize`); one submitted to another endpoint than this server's fails
  `target_mismatch` without a provider call (`failElsewhere`), and is not refunded.
- `finalizing`: resumed by that poll, which downloads the outputs again with the attempt counter
  it had (`finalize_attempts`; the third failure fails it `finalize_failed`).
- `done`, `failed`, `unknown`, `cancelled`: final, untouched.

`IN_FLIGHT_MAX` (default 1) is one cap over every workflow: there is one `generations` table and
one dispatcher. `IN_FLIGHT_MAX=0` refuses new generations with 503 `queue_full`, waiting ones
included. Every submit carries the row's idempotency key; a submit error the provider refused
fails the row, any other makes it `unknown`.

## Quota, refunds and rate limits

- **Charge.** Inserting a `generations` row with an access code increments `access_codes.used`
  (trigger `access_codes_count_generation`); a `waiting` row is charged when it is stored.
- **Refund.** `preparing → failed` (the provider never took the job) and `waiting → cancelled`
  give the count back (triggers in `shared/002-waiting-queue.sql`). `unknown` never does; neither
  does a `queued`/`running` row failed `target_mismatch` (the other endpoint accepted it).
- **Reuse.** A recipe with a done or pending generation of the same workflow returns that
  generation (`reused: true`): no row, no charge, no place in line. A re-run of a done
  generation on an unchanged target is such a reuse.
- **`submitMany`.** Every item is validated first (422 `invalid_input` naming the item); then
  one `BEGIN IMMEDIATE` transaction resolves each recipe, checks `used + new <= max_generations`
  for the code (else 403 `code_exhausted` for the whole request) and stores every new item
  `waiting`, in order. Any refusal stores nothing. Reused items and items repeating an earlier
  item of the request are free. Per-item failures and refunds follow the single-generation rules.
- **Rate limit.** One `generate` token per request (`GENERATE_RATE_LIMIT`, per client and per
  code), taken only by a request that stores a row; a reused answer gives its token back.

## Request keys

A request may carry `request_key` (a UUID in the JSON body, read by `readInput`), passed to
`submit`/`submitMany` as `requestKey`. `generation_requests (workflow_id, request_key)`
(`shared/003-generation-requests.sql`) records the answer each key got, reused answers too:

- The key is looked up before the recipe is prepared, so a request repeated after a lost answer
  gets the same generation even when its seed was drawn at random, and even if that generation
  was cancelled since.
- Keys are per workflow. A key first used by another access code is a 409.
- `submitMany` records `<requestKey>#<index>` per item (`batch_key = requestKey` on the rows).
- Two concurrent requests with one key: after the cap-refresh wait the key is resolved again
  before reuse and quota checks, with no await until the answer is stored, so one row is
  stored, charged and rate-limited once, and both get the same receipt.

Request keys are a client contract, not a user-facing one. Motion Transfer's client
(`use-generate.ts`) does not send one today; a feature that retries requests should.

## Ownership and branching

Each team owns its feature directory, its route source files and its migration namespace. The
foundation/integration owner owns `src/shared/`, `src/app/` (composition), global CSS and design
tokens, shadcn primitives (installed once with `npx shadcn@latest add …`), dependencies and
configuration, Dockerfiles and deployment tooling. Shared contracts change additively after the
split. Cross-feature schema changes go through the owning team.

Every feature issue branches from the foundation commit (this work merged to `main`), as
`codex/<feature>` unless another name is requested. Merge small working slices; do not reformat
or refactor directories you do not own. `src/routeTree.gen.ts` is shared and generated: after
merging route sources, regenerate it with `npm run dev` or `vite build`, then typecheck; never
hand-merge it or use `tsr`. `npm run build` typechecks first, so regenerate before building when
the committed tree is stale. `npm run check` stays read-only.

| Issue | Feature directory | Consumes |
| --- | --- | --- |
| DEV-289 presets | `presets` | The draft contract: a preset is a `MotionTransferDraft` opened with `draftHref` (validated by `parseDraft`); fixtures from `motionTransfer/api.ts`. |
| DEV-290 Explore/remix | `explore` | Share pages `/r/:slug` and published outputs (`generation_outputs`, `generationAccess`); remix links `draftHref({ from, … })`. |
| DEV-291 looks | `looks` | The `directionEditor` slot (`DirectionEditorProps`), mounted in `src/app/composer-slots.ts`. |
| DEV-292 batches | `batches` | The `directGenerationActions`/`resultGenerationActions` slots with `DraftSnapshot`, `withSeed`/`withCharacter`; `submitMany` with a request key; the dispatcher and `waiting` receipts. It adds its own HTTP route and migration namespace. |
| DEV-293 character library | `characters` (exists) | `src/features/characters/api.ts` and `index.ts` (`listCharacters`, `characterListQuerySchema`, `characterListSchema`), `POST /api/characters`, `PATCH /api/characters/:id`, its `GET /api/characters` and `/characters`; the `characterPicker` slot with `carryDraft`/`carriedDraft`. |
| DEV-294 character builder UI | `characterBuilder` (`components/`, client helpers, `tests/*.spec.ts`; `/characters/new`) | The contracts of `characterBuilder/index.ts` and `tests/fixtures.ts`, `generationSchema.outputs`, `useLiveGeneration`, `carriedDraft` and `draftHref(withCharacter(…))` for "Use for animation". |
| DEV-297 FLUX 3 workflows | `characterBuilder` (`workflows/`, `server/`, its server tests; the caption, generation and save routes), `selfhost/`, the model scripts | `OutputDeclaration` media `text`, `models.lock` pins of BFL's FLUX 3 repository; implements the contracts of `characterBuilder/contracts.ts`. |

For DEV-293/294/297 the integration owner (one agent at a time) owns `src/shared/**` (migrations
too), `src/app/**`, the committed `src/routeTree.gen.ts`, `package.json` and the lockfile,
`playwright.config.ts`, `.github/workflows/ci.yml`, `.fallowrc.jsonc`, Motion Transfer's slot
seams, `src/features/studio/**`, `characterBuilder/{contracts,index,api}.ts`,
`characters/contracts.ts`, this document and `AGENTS.md`. A track that needs a change there asks
the owner; the owner may grant a one-line composition edit (mounting a slot component or
composing a workflow definition) on the track's branch.

## Running and verifying the foundation

### Commands

```sh
npm ci
cp .env.example .env            # backend settings: README "Getting started"
npm run dev                     # vite dev on PORT (default 3030); migrates, seeds, recovers, dispatches
node --env-file=.env scripts/mint-code.mjs me 100   # an access code, once the app has started
node scripts/seed-samples.mjs   # seed a DATABASE_PATH without starting the server

npm run check                   # typecheck, lint, format, fallow, import boundaries (read-only)
npm run test:server             # node:test over tests/ and every feature's and shared server's tests
npm run test:e2e                # Playwright; own dev server on BASE_URL with a fresh database
npm run check:models            # every runtime workflow against its models.lock, aggregated
npm run check:open-weights      # no partner/API nodes in any workflow JSON
npm run build && npm run check:client   # no Comfy configuration in the client bundle
npm run check:privacy           # docs/priv/ and .env never tracked
npm run check:comfy             # the configured Comfy target answers and authorizes
```

Test discovery: `tests/*.test.ts`, `src/features/*/server/**/*.test.ts`,
`src/features/*/tests/*.test.ts`, `src/shared/server/**/*.test.ts`; Playwright `tests/**/*.spec.ts`
(project `chromium`), `src/features/*/tests/*.spec.ts` (project `features`) and
`src/features/*/tests/*.fake.spec.ts` (project `fake`). `test:e2e` starts two dev servers, each on
a fresh database seeded by `tests/e2e/seed.ts` with its own access code and signed-in browser
state (`sign-in` and `fake-sign-in`): at `BASE_URL`, Comfy at a dead port and `IN_FLIGHT_MAX=2`,
because the seed adds one `queued` generation that takes a place; at `FAKE_BASE_URL` (default:
`BASE_URL`'s port + 1), `COMFY_PROVIDER=fake` with `COMFY_FAKE_STEP_MS=100` and
`IN_FLIGHT_MAX=4`, for flows whose generations must finish (no seeded `queued` row there). Name a
browser test `*.fake.spec.ts` when it needs a generation to succeed; it then runs only in `fake`.

### Environment

| Variable | Default | Read by | Purpose |
| --- | --- | --- | --- |
| `COMFY_API_KEY` | — | `comfy-target.ts` | Comfy Cloud. |
| `COMFY_BASE_URL`, `COMFY_PROXY_TOKEN` | — | `comfy-target.ts` | Self-hosted ComfyUI behind the proxy. |
| `COMFY_PROVIDER` | `comfy` | `comfy-provider.ts` | `fake` for development and tests; refused by a built server and `NODE_ENV=production`. |
| `COMFY_FAKE_SCENARIO` | `success` | `comfy-provider.fake.ts` | `success`, `provider_failed` or `ambiguous` for submits without a `[fake:<scenario>]` marker. |
| `COMFY_FAKE_STEP_MS` | 250 | `comfy-provider.fake.ts` | Time between a fake job's events. |
| `PORT` | 3030 | `vite.config.ts`, the built server, `compose.yaml` | Dev server port; Compose host port. |
| `DATABASE_PATH` | `data/app.sqlite` | `paths.ts` | Database; stored files go in `assets/` beside it. |
| `BASE_URL` | `http://127.0.0.1:3032` | `playwright.config.ts` | The e2e dev server (Comfy at a dead port). |
| `FAKE_BASE_URL` | `BASE_URL`'s port + 1 | `playwright.config.ts` | The e2e dev server on the fake provider (project `fake`). |
| `E2E_DATABASE_PATH`, `E2E_FAKE_DATABASE_PATH` | a new temporary directory each | `playwright.config.ts` | The two e2e databases. |
| `COMPOSE_PROJECT_NAME` | the directory name | Docker Compose | Compose project and volume (`<name>_sqlite-data`). |
| `IN_FLIGHT_MAX` | 1 | `limits.ts` | Generations `preparing..finalizing` at once; 0 refuses new ones. |
| `GENERATION_DISPATCH_MS` | 3000 | `dispatcher.ts` | Dispatcher wake and poll interval. |
| `GENERATE_RATE_LIMIT`, `UPLOAD_RATE_LIMIT`, `LOGIN_RATE_LIMIT`, `LOGIN_TOTAL_RATE_LIMIT` | 3, 10, 10, 300 | `limits.ts` | Per-minute limits. |
| `PUBLIC_APP_URL`, `CLIENT_IP_HEADER`, `ENABLE_DEBUG` | — | see `.env.example` | Deployment settings. |

### Fake provider

`src/shared/server/comfy-provider.fake.ts` implements `Provider` in process. A target must
still resolve, and the recipe records it; a dead self-host port needs no key:

```sh
COMFY_PROVIDER=fake COMFY_API_KEY= COMFY_BASE_URL=http://127.0.0.1:1 npm run dev
```

Every `Save*Video` node returns `tests/fixtures/fake-output.mp4`, every `SaveImage`/`PreviewImage`
node `tests/fixtures/fake-output.png`, every `SaveText` node the text file
`tests/fixtures/fake-output.txt` (type `file`, a `.txt` name), with progress at 25/50/75 %.
`provider_failed` fails the
job; `ambiguous` accepts it and then throws from `submit`, which leaves the row `unknown`. A
reused idempotency key throws the SDK's `IdempotencyKeyReuse`. Fake job ids describe the job, so a
restarted server can still follow a job the stopped one submitted. Server tests set
`process.env.COMFY_PROVIDER = "fake"` (and usually `COMFY_FAKE_STEP_MS = "0"`) or pass
`fakeProvider`.

### Waiting queue

With every place in flight taken (or others already waiting on the same endpoint),
`POST /api/generate` and `POST /api/character-generations` answer 202
`{ id, reused: false, status: "waiting", position }`; `GET /api/generations/:id` reports
`status: "waiting"` and `position` (1 is next), and Motion Transfer's progress view shows the
line. The dispatcher starts waiting rows in order with no browser connected. `IN_FLIGHT_MAX=0`
answers 503 `queue_full` and stores nothing.

### Several worktrees

Give each worktree its own `PORT`, `DATABASE_PATH` (and with it `assets/`), `BASE_URL` for
`test:e2e`, and `COMPOSE_PROJECT_NAME`; `E2E_DATABASE_PATH` is already a fresh temporary file per
run, and browser storage state lives beside it. Example `.env` additions for a second worktree:

```dotenv
PORT=3031
DATABASE_PATH=data/worktree-b.sqlite
BASE_URL=http://127.0.0.1:3033
COMPOSE_PROJECT_NAME=open-photon-b
```

Separate databases do not share one `IN_FLIGHT_MAX`: two worktrees on one real GPU each admit
up to their own cap. Point real-GPU runs at separate targets, or coordinate them by hand; use
the fake provider otherwise.

### Sizing per lock

| Workflow | Lock | Weights | Peak VRAM |
| --- | --- | --- | --- |
| `motion-transfer.v1` (Wan Animate 2) | 5 files, `Comfy-Org/Wan-Animate-2` @ `e7181fe` | 25.6 GB (23.9 GiB) | Measured 31,426 MiB for a 5 s 480×848 render on an RTX 5090 32 GB, and 38,935 MiB (whole-device peak while the generation ran) on an A40 48 GB with image `0.2.0`; 48 GB recommended |
| `character-generation.v1` (FLUX 3 Image Klein distilled, int8) | 3 files: 2 from `black-forest-labs/flux-3-image-klein-comfy` @ `feef60b` (gated), VAE from `Comfy-Org/Flux-2-Klein-4B` @ `533c4cb` | 11.0 GB (10.3 GiB) | Measured 10,653 MiB (whole-device peak while the generation ran) for 768×1344 on an A40 |
| `character-caption.v1` (FLUX 3 prompt upsampler, w4a8) | 1 file, `black-forest-labs/flux-3-image-klein-comfy` @ `feef60b` (gated) | 6.7 GB (6.3 GiB) | Measured 6,601 MiB (whole-device peak while the generation ran) on an A40 |
| Every lock (installed on each pod boot) | 9 distinct files | 43.4 GB (40.4 GiB) | One GPU runs one job at a time: the largest peak, Motion Transfer's |

Weights are the `x-linked-size` of each pinned URL (for the gated FLUX 3 files, which answer 401
without a token, the `size` the Hugging Face tree API lists). Disk and volume must hold the sum;
the GPU the largest peak. `selfhost/runpod-template.json` gives `/workspace` (where
`install-models.mjs` puts the weights) 80 GB: the sum plus about 36 GB for ComfyUI's inputs and
outputs and the proxy's job records. The container disk (50 GB) holds only the image and
ComfyUI's temporary files. The private deployment guide's disk recommendation
(`docs/priv/deployment.md`) was written for Motion Transfer's ≈ 26 GB and should follow it.

## Verification status

Gate reported by the slices: at `84e48b5`, `npm run check` exit 0, `npm run test:server`
162/162 and `npm run test:e2e` 49 passed, 1 failed (`tests/compare.spec.ts:135`, which fails the
same way at `37a7a0b`); at `24c3b92`, `npm run check:models` "8 distinct model files across 2
feature locks, 0 conflicts" and `npm run check:open-weights` "310 nodes scanned in 12 JSON files,
0 forbidden".

| Claim | Status | Evidence |
| --- | --- | --- |
| Motion Transfer through the shared service; historical recipes hash as recorded | Proven in tests | `src/features/motionTransfer/server/historical-recipes.test.ts` (one fixture per stored shape) |
| Migrations upgrade a production database; links and character references survive | Proven on a copy of `data/app.sqlite` | Slice reports (F1, F2); `migrate.test.ts`, `outputs-migration.test.ts`, `queue-migration.test.ts` |
| Image workflow through the same service, no image-specific branch | Proven on Comfy Cloud | `src/features/characterBuilder/workflows/README.md`, "Integration smoke": two renders, `/g` and `/r` 200, saved with `createFromGeneration` |
| Generated character animated by Motion Transfer through the service | Proven on Comfy Cloud | Same section: two Motion Transfer renders, 480×848, 5.0 s |
| Waiting queue, ordered dispatch without a browser, restart recovery, `submitMany`, request keys | Proven with the fake provider | `src/shared/server/generation/dispatcher.test.ts`, `service.test.ts`; `tests/generate.spec.ts` waiting case |
| Characters API, idempotent save under concurrency, privacy of uploads | Proven in tests | `src/features/characters/tests/*.test.ts`, `*.spec.ts` |
| Fake provider refused by a built server | Proven | `NODE_ENV=production node .output/server/index.mjs` exits 1 (F1 report) |
| Waiting queue against a real provider | Not verified on Cloud or selfhost | — |
| Any render on the self-host image | Proven on selfhost (Runpod A40, image `0.2.0` from `723614c`) | `src/features/characterBuilder/workflows/README.md`, "Self-host": caption, image and Motion Transfer generations passed `scripts/verify-selfhost.mjs` |
| Packaged runtime: image lists namespaced migrations, a fake generation inside the image, restart in the image | Not verified | Only `docker build --check` for both Dockerfiles and an arm64 app image listing `src/features/characterBuilder` were run |
| Two worktrees running `test:server` and `test:e2e` at once | Not verified | Ports and databases are parameterized; no simultaneous run recorded |

Steps 2–4 below passed on a Runpod A40 with the published image `0.2.0` (2026-10-23; step 1's
rebuild and step 5 were not run). To repeat them, someone with a Runpod pod:

1. Builds and pushes the self-host image from the foundation commit
   (`docker build --platform linux/amd64 -f selfhost/Dockerfile -t <registry>/open-photon-comfy:<tag> .`)
   and the app image; lists `/opt/open-photon/src/features/*/workflows` in the first and
   `/app/src/shared/server/migrations` in the second.
2. Starts a pod with volume room for 43.4 GB of weights; the boot log shows both
   `<feature>/<id>.v1: … 0 missing` lines and `Serving the Comfy API v2 on 0.0.0.0:8189 (auth: bearer)`.
3. Runs `COMFY_API_KEY= COMFY_BASE_URL=https://<pod-id>-8189.proxy.runpod.net COMFY_PROXY_TOKEN=<token> npm run check:comfy`.
4. Enhances a caption, renders one character from it (`POST /api/character-captions`,
   `POST /api/character-generations`) and one Motion Transfer take of it, following
   `src/features/characterBuilder/workflows/README.md`, "Self-host", while `nvidia-smi` records
   GPU memory, and checks all three with `scripts/verify-selfhost.mjs` (status, `target:
   selfhost`, workflow SHA-256, pins, outputs, peak VRAM and latency per generation).
5. With `IN_FLIGHT_MAX=1`, submits three generations, restarts the app while one is in flight,
   and checks they all finish once with one provider job each.

## Open points

- `tests/compare.spec.ts:135` (a laptop-screen layout check, 823 > 800 px) fails at `37a7a0b`
  and on the branch; it is not caused by the foundation.
- `/g/:id` titles every result "Your take · Motion Transfer · Open Photon"
  (`src/routes/g.$generationId.tsx`), image generations included; the page shell belongs to
  Motion Transfer.
- `src/features/motion-score/` is an unwired Python PoC; it is never imported and none of its
  files is a runtime workflow, but the app image packages its `workflows/` and `samples/` and the
  self-host image its `workflows/`. Decide whether it stays under `src/features/`.
- No HTTP route calls `submitMany` and no route cancels a waiting generation; batches (DEV-292)
  own both.
- Waiting queue against a real provider (step 5 above), packaged-runtime and two-worktree
  verification.
