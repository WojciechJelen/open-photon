import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

// One-time, rerunnable rename. Keep historical logs, external documentation URLs,
// and the partner-node negative control intact. Vite regenerates the route tree.
const ownPath = "scripts/rename-motion-transfer.mjs";

const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    encoding: "utf8",
  },
).split("\0");

for (const path of new Set(paths)) {
  if (!path || path === ownPath || path === "src/routeTree.gen.ts" || path.endsWith(".log")) {
    continue;
  }

  if (!existsSync(path)) continue;

  const bytes = readFileSync(path);

  if (bytes.includes(0)) continue;

  const source = bytes.toString("utf8");
  const protectedValues = [];

  const updated = source
    .replace(
      /HiggsfieldGenjutsuMotionTransfer|https:\/\/open-photon-docs\.vercel\.app\/[^\s)]+/g,
      (value) => {
        protectedValues.push(value);

        return `__MOTION_TRANSFER_RENAME_${protectedValues.length - 1}__`;
      },
    )
    .replace(/genj[ui]tsu-(header|wizard)/g, "motion-transfer-$1")
    .replace(/(["'`])\/Genj[ui]tsu\//g, "$1/MotionTransfer/")
    .replace(/\bGenj[ui]tsu(?=[A-Z])/g, "MotionTransfer")
    .replace(/(function |component: )Genj[ui]tsu\b/g, "$1MotionTransfer")
    .replace(/genj[ui]tsu/g, "motionTransfer")
    .replace(/Genj[ui]tsu/g, "Motion Transfer")
    .replace(/__MOTION_TRANSFER_RENAME_(\d+)__/g, (_, index) => protectedValues[Number(index)]);

  if (updated !== source) writeFileSync(path, updated);
}

for (const [from, to] of [
  ["src/features/genjutsu", "src/features/motionTransfer"],
  ["src/routes/genjutsu.tsx", "src/routes/motionTransfer.tsx"],
  [
    "src/features/motionTransfer/components/genjutsu-header.tsx",
    "src/features/motionTransfer/components/motion-transfer-header.tsx",
  ],
  [
    "src/features/motionTransfer/components/genjutsu-wizard.tsx",
    "src/features/motionTransfer/components/motion-transfer-wizard.tsx",
  ],
]) {
  if (!existsSync(from)) continue;

  if (existsSync(to)) throw new Error(`Cannot rename ${from}: ${to} already exists`);

  renameSync(from, to);
}
