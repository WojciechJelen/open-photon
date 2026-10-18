import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
}

const historicalDocuments = new Set([
  "docs/independent-verification-report.md",
  "docs/spike-test.md",
  "docs/upload-memory-recheck.md",
  "docs/video-readiness.md",
  "docs/wan-live-verification.md",
]);

function isPrivate(path) {
  return (
    path === "docs/priv" ||
    path.startsWith("docs/priv/") ||
    /(^|\/)\.env(?:\.|$)/.test(path) ||
    historicalDocuments.has(path)
  );
}

assert.equal(
  git("rev-parse", "--is-shallow-repository"),
  "false",
  "Privacy verification requires full history; fetch with --unshallow or use fetch-depth: 0.",
);

const indexed = git("ls-files", "-z").split("\0");

const historical = git("rev-list", "--objects", "--all")
  .split("\n")
  .map((entry) => entry.slice(entry.indexOf(" ") + 1));

const privatePaths = [...new Set([...indexed, ...historical].filter(isPrivate))];

assert.deepEqual(
  privatePaths,
  [],
  "Private files are tracked or reachable in Git history. Remove them before publishing.",
);

for (const path of ["docs/priv/privacy-check.md", "docs/priv/nested/privacy-check.md", ".env"]) {
  assert.equal(git("check-ignore", path), path, `Missing Git ignore rule for ${path}`);
}

console.log(
  "Privacy check passed: private paths are ignored and absent from the index and history.",
);
