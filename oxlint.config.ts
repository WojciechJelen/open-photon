import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [
    ".output",
    ".tanstack",
    "test-results",
    "src/routeTree.gen.ts",
    "src/components/ui",
    // The vendored plugin is upstream source; it lints under its own repo's rules.
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [
    "@shadcn/lint",
    // Vendored from github.com/dmmulroy/anti-slop @ 13909c9. @oxlint/plugins is
    // pinned to the exact oxlint version (1.88.0) that this plugin API requires.
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
  ],
  settings: {
    shadcn: {
      ui: "#/components/ui",
      variantFunctions: ["cva"],
    },
  },
  rules: {
    "oxc/no-accumulating-spread": "error",

    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",

    "shadcn/no-arbitrary-values": "error",
    "shadcn/no-inline-styles": "error",
    "shadcn/no-raw-colors": "error",
    "shadcn/no-restyle": "error",
    "shadcn/no-unknown-classes": "error",
    "shadcn/require-static-classes": "error",
  },
  overrides: [
    {
      // .mjs verification scripts run on Node with its globals, as do the tests.
      env: { node: true },
      files: ["scripts/**", "tests/**", "src/**/*.test.ts", "src/features/*/tests/**"],
    },
    {
      // Asserting on raw response shapes is what these tests exist to do, and
      // node:test owns the promise returned by each `test()` call. Feature-local tests
      // (`src/**/*.test.ts`, `src/features/*/tests/`) follow the same rules.
      files: ["tests/**", "src/**/*.test.ts", "src/features/*/tests/**"],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
        "typescript/no-floating-promises": "off",
      },
    },
  ],
});
