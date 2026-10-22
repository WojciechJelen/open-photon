// node scripts/check-import-boundaries.mjs (in `npm run check` as `lint:boundaries`; read-only)
//
// Checks every import (static, `export … from`, type-only and dynamic `import()`) under `src/`,
// `#/`, `@/` and relative specifiers alike, against the composition rules:
// - `src/shared/**` and `src/start.ts` never import `src/features/**`: shared code that needs a
//   feature's declarations takes them from `src/app/`, the one module that composes features.
// - A feature imports another feature only through its public module, `index.ts` or `api.ts`.
// - A feature never imports `src/app/**` (the composition imports features, not the reverse).
// `src/app/**` and `src/routes/**` may import features and shared code.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const extensions = [".ts", ".tsx"];

/** Every source file under `dir`, as a path relative to the repository root. */
function sourceFiles(dir) {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx|mjs|js)$/.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

/** The repository path a specifier names, or `null` for a package or built-in. */
function resolveSpecifier(file, specifier) {
  let base;

  if (specifier.startsWith("#/") || specifier.startsWith("@/")) {
    base = join(root, "src", specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = resolve(root, dirname(file), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    ...extensions.map((extension) => base + extension),
    ...extensions.map((extension) => join(base, `index${extension}`)),
  ];

  const found = candidates.find((candidate) => existsSync(candidate) && !isDirectory(candidate));

  return relative(root, found ?? base)
    .split("\\")
    .join("/");
}

function isDirectory(path) {
  try {
    readdirSync(path);

    return true;
  } catch {
    return false;
  }
}

const featureOf = (path) => /^src\/features\/([^/]+)\//.exec(path)?.[1];

/** Why `file` may not import `target`, or `null` when it may. */
function violation(file, target) {
  const targetFeature = featureOf(target);
  const sourceFeature = featureOf(file);

  if ((file.startsWith("src/shared/") || file === "src/start.ts") && targetFeature) {
    return "shared code and src/start.ts must not import a feature; compose it in src/app/";
  }

  if (sourceFeature && target.startsWith("src/app/")) {
    return "a feature must not import src/app/ (the composition imports features, not the reverse)";
  }

  if (
    sourceFeature &&
    targetFeature &&
    sourceFeature !== targetFeature &&
    !/^src\/features\/[^/]+\/(?:index|api)\.tsx?$/.test(target)
  ) {
    return `imports ${targetFeature}'s internals; use src/features/${targetFeature}/index.ts or api.ts`;
  }

  return null;
}

const problems = [];

for (const file of sourceFiles("src")) {
  if (
    !file.startsWith("src/features/") &&
    !file.startsWith("src/shared/") &&
    file !== "src/start.ts"
  ) {
    continue;
  }

  const source = readFileSync(join(root, file), "utf8");

  for (const { fileName, pos } of ts.preProcessFile(source, true, true).importedFiles) {
    const target = resolveSpecifier(file, fileName);
    const reason = target === null ? null : violation(file, target);

    if (reason) {
      const line = source.slice(0, pos).split("\n").length;
      problems.push(`${file}:${line}: "${fileName}" ${reason}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Import boundary violations (${problems.length}):\n${problems.join("\n")}`);
  process.exit(1);
}

console.log("Import boundaries hold.");
