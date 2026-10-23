# shadcn instructions

Use the latest version of Shadcn to install new components, like this command to add a button component:

```bash
npx shadcn@latest add button
```

# Layout

- `src/features/<feature>/`: everything one feature owns: `components/`, `server/`,
  `workflows/`, `samples/`, `tests/`, contracts (zod schemas and types), client helpers and
  server functions. Features: `motionTransfer` (the wizard, `/motionTransfer`), `characters`
  (workspace character library, sample characters), `characterBuilder` (character images:
  caption, generation and save contracts, `POST /api/character-generations`), `studio` (home page `/`),
  `presets` (curated Motion Transfer presets, `/presets`) and
  `motion-score` (a Python/ComfyUI PoC: nothing imports it and no workflow of it is a runtime
  workflow, but both images package its `workflows/` and the app image its `samples/`).
- A feature's public surface is `api.ts` (server code of other features) and `index.ts`
  (client code). Nothing else of a feature may be imported from outside it.
- `src/app/`: the composition, the only code that brings feature implementations into shared
  code. `server.ts`: workflow definitions (`workflows.compose([...])`), seeders
  (`seedDatabase`) and public-access declarations (`createAccessPolicy([...])`). `boot.ts`: the
  Nitro plugin that seeds, recovers after a restart (`recoverAfterRestart`) and starts the
  dispatcher (migrations already ran when `db.server.ts` opened the database).
  `composer-slots.ts`: which component fills each Motion Transfer composer slot.
- `src/shared/`: code no single feature owns: `components/`, `contracts.ts` (client-safe
  generation/asset contracts), `server/` (access, database, migrations, asset store, uploads,
  media serving, Comfy plumbing) and client helpers.
- `src/shared/server/generation/`: the generation service every workflow runs through.
  `definition.ts` (`WorkflowDefinition`, `OutputDeclaration`, `recipeIdentitySchema`, the
  `workflows` registry), `service.ts` (`submit`, `submitMany`, `retry`, `rerun`,
  `readGeneration`), `generations.ts` (rows and the status machine), `finalize.ts` (stores
  the outputs a definition declares), `dispatcher.ts` (waiting queue, polling, restart
  recovery), `stream.ts` (SSE), `http.ts` (`answer`, `readInput`), `pages.ts` (`/g`, `/r`).
  A feature never inserts or updates `generations` rows itself.
- `src/shared/server/access-policy.ts`: the rule engine; each feature declares what it makes
  public (`PublicAccessDeclaration`, its `server/public-access.ts`). Anything undeclared needs a
  session.
- Migrations: `src/shared/server/migrate.ts` runs `src/shared/server/migrations/`. New ones go
  in `<domain>/NNN-name.sql` (identity `<domain>/NNN`, e.g. `characters/001`). The flat
  `001`–`007` files are frozen as `legacy/NNN`; a flat `008` is refused. Order: `legacy`,
  `shared`, then other domains alphabetically, numeric within one. An applied migration is
  immutable: its SHA-256 is recorded and a changed file stops startup; add a new one instead.
- `src/components/ui/`: shadcn primitives only.
- `src/routes/`: TanStack file routes; thin, they import from features and shared.
- Comfy plumbing every feature shares lives in `src/shared/server/`: `comfy-target.ts` (Cloud
  from `COMFY_API_KEY`, or self-host from `COMFY_BASE_URL` + `COMFY_PROXY_TOKEN`), `comfy-boot.ts` (Nitro boot check), `comfy-provider.ts`
  (SDK transport), `comfy-provider.fake.ts`, `comfy-assets.ts`, `workflow-graph.ts`,
  `models-lock.ts`, `comfy-workflows.ts`.
- A runtime workflow is `src/features/<feature>/workflows/<id>.v<N>.json` plus its sibling
  `<id>.v<N>.inputs.json`; its model pins are the sibling `models.lock`. `discoverWorkflows`
  finds them; anything else under `workflows/` (nested exports, `*.api.json`) is ignored.
- Both Dockerfiles package every feature's `workflows/` (the app image also `samples/`) without
  per-feature lines, and the app image the whole migrations directory; `npm run check:models` and
  `scripts/install-models.mjs` cover every discovered workflow and every feature's lock.

Files that Node loads in `test:server` (everything under a `server/`, `workflows/` or `tests/`
folder, `src/app/server.ts`, and what those import) use relative imports with the `.ts`
extension; client code uses `#/`.

# Import boundaries

`scripts/check-import-boundaries.mjs` (`lint:boundaries`, part of `npm run check`) checks every
import under `src/` (`#/`, `@/` and relative; static, type-only and dynamic):

- `src/shared/**` and `src/start.ts` never import `src/features/**`; compose in `src/app/`.
- A feature imports another feature only through its `index.ts` or `api.ts`.
- A feature never imports `src/app/**`.
- `src/app/**` and `src/routes/**` may import features and shared code.

# Access, requests and the queue

- Server-function ids in a feature's `publicServerFns` are `<source path>#<export>`: moving a
  `*.functions.ts` file means updating its declaration.
- A new feature with public routes, assets or server functions exports a
  `PublicAccessDeclaration` from `server/public-access.ts` and adds it to `createAccessPolicy`
  in `src/app/server.ts`; a workflow adds its definition to `workflows.compose`; data every
  database needs is an idempotent seeder added to `seeders`.
- A generation request body may carry `request_key` (a UUID): the same key for the same
  workflow returns the first answer (`generation_requests`), from another access code a 409.
  `submitMany` stores item keys as `<key>#<index>`.
- `IN_FLIGHT_MAX` (default 1) bounds `preparing`..`finalizing` across every workflow on the
  endpoint the server renders on (one `generations` table, one dispatcher). When it is full or
  others already wait, a new generation is stored `waiting` and answered 202 with its `position`;
  the dispatcher starts it in order. `IN_FLIGHT_MAX=0` refuses new generations (503 `queue_full`).

Contracts, recovery, quota and request-key rules: `docs/parallel-feature-foundation.md`.
Adding a feature or workflow: `.claude/skills/add-new-feature/SKILL.md`.

# Toolchain

Type checking, linting, and formatting are oxc/tsgo based. Do not reintroduce
Biome, Prettier, ESLint, or `tsc` for these jobs.

```bash
npm run check        # typecheck + lint + format check + fallow + import boundaries, in parallel
npm run fix          # autofix lint findings, format, then typecheck
npm run typecheck    # tsgo --noEmit against the committed route tree
npm run test:server  # node:test suite
npm run test:e2e     # Playwright; starts its own dev server on :3032 with a fresh database
```

- **Test discovery.** `test:server` runs `tests/*.test.ts`,
  `src/features/*/server/**/*.test.ts`, `src/features/*/tests/*.test.ts` and
  `src/shared/server/**/*.test.ts`. Playwright runs `tests/**/*.spec.ts` (project `chromium`)
  and `src/features/*/tests/*.spec.ts` (project `features`) against a server with Comfy at a
  dead port, and `src/features/*/tests/*.fake.spec.ts` (project `fake`) against a second one on
  the fake provider (`FAKE_BASE_URL`, default `BASE_URL`'s port + 1), for flows whose
  generations must finish. A feature's tests and fixtures live
  in the feature; a server test that loads the database imports `tests/temp-database.ts` first.
- **Fake provider.** `COMFY_PROVIDER=fake` (`src/shared/server/comfy-provider.fake.ts`) answers
  every Comfy call in process with `tests/fixtures/fake-output.{mp4,png,txt}`. Per submit it runs
  the graph's `[fake:<scenario>]` marker, else `COMFY_FAKE_SCENARIO`, else `success`
  (`success`, `provider_failed`, `ambiguous`); `COMFY_FAKE_STEP_MS` paces its progress. A
  target must still resolve (`COMFY_API_KEY= COMFY_BASE_URL=http://127.0.0.1:1`). A built
  server or `NODE_ENV=production` refuses to boot with it; values other than `comfy` (the
  default) and `fake` are an error. A server test opts in by setting
  `process.env.COMFY_PROVIDER = "fake"` before the first provider call, or passes `fakeProvider`.
- **Worktrees.** Give each one its own `PORT` (`npm run dev`, Compose host port; default 3030),
  `DATABASE_PATH` (its `assets/` sit beside it), `BASE_URL` (`test:e2e` server, default
  `http://127.0.0.1:3032`) and `COMPOSE_PROJECT_NAME` (Compose project and volume). Separate
  databases do not share one `IN_FLIGHT_MAX`: point real-GPU runs at separate targets or
  coordinate them by hand. `GENERATION_DISPATCH_MS` (default 3000) sets the dispatcher's poll.

- **tsgo** (`@typescript/native-preview`) type checks; `typescript` stays installed
  for the editor language service and Vite plugins.
- **Route tree**: `src/routeTree.gen.ts` is generated by the TanStack Start Vite
  plugin on `npm run dev` and `vite build`, with the Start registration footer.
  Commit it with every route change. `typecheck` reads the committed file and
  never regenerates it, so a tree that misses a route fails the typecheck. Do not
  use the `tsr` CLI: it writes the tree without the Start footer.
- **Oxfmt** formats (`.oxfmtrc.jsonc`): 2 spaces, double quotes, import and
  Tailwind class sorting. `src/components/ui` and `src/routeTree.gen.ts` are
  excluded, as they were under Biome.
- **Oxlint** lints (`oxlint.config.ts`) with `--type-aware`, plus two JS plugins:
  `@shadcn/lint` for the Tailwind design system, and **anti-slop**, vendored into
  `tools/oxlint/anti-slop`. `@oxlint/plugins` and `oxlint` are pinned to the same
  exact version (1.88.0); bump them together or the plugin API breaks.
- **Fallow** (`.fallowrc.jsonc`) checks what per-file lint cannot: unused files,
  exports and dependencies (`fallow dead-code`) and copy-paste across files
  (`fallow dupes`). Scripts and `tests/type-contracts.ts` are declared entries.
  Delete an unused export rather than suppressing it; a run-by-hand file
  belongs in `entry`.
## Do not sort route option keys

TanStack Router infers route types *positionally*: `validateSearch` feeds
`loaderDeps`, which feeds `loader`, which feeds `component`. TypeScript resolves
those dependent inferences in source order, so reordering the keys of the object
passed to `createFileRoute(...)()` collapses the inferred types to `{}` and
produces a wall of TS2339 errors.

No currently enabled rule sorts object keys. `eslint-plugin-perfectionist` did
(via `@nkzw/oxlint-config`) and broke the build this way; both were removed. If
anything that sorts object keys is ever added back, exempt `src/routes` first:

```ts
{ files: ["src/routes/**"], rules: { "perfectionist/sort-objects": "off" } }
```

`tests/type-contracts.ts` is the tripwire for this class of break: it asserts the
route search and loader types still resolve, so `npm run typecheck` fails loudly
if inference ever collapses again. Keep it in the typecheck path.

`npm run fix` typechecks after autofixing for the same reason: an autofix can be
syntactically safe and still destroy inference, so the fixer verifies its own
output. Keep that last step. Never add `--fix` to `npm run check` — verification
must stay read-only, or an unreviewed autofix can ride along into a commit.
