# Vendored Oxlint plugins

## anti-slop

- Source: https://github.com/dmmulroy/anti-slop
- Commit: `13909c9`
- Copied from: `skills/install-anti-slop/assets/anti-slop/`
- Local changes: none. The `effect/` rules were omitted because this project
  does not use Effect; upstream says to register those only in Effect repos.

anti-slop has no npm package and is meant to be vendored. `anti-slop/index.ts`
imports `@oxlint/plugins`, whose plugin API must match the Oxlint version
exactly, so `oxlint` and `@oxlint/plugins` are both pinned to `1.88.0` in
`package.json`. Bump them together.

`.oxfmtrc.jsonc` and `oxlint.config.ts` both exclude this directory so the copy
stays byte-comparable to upstream. To update: re-copy from the repo at the new
commit, bump both pinned versions, and record the new commit here.
