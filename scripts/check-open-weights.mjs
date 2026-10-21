import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const patterns = z
  .array(z.string().min(1))
  .min(1)
  .parse(JSON.parse(readFileSync(new URL("./forbidden-nodes.json", import.meta.url), "utf8")));

const forbidden = patterns.map(
  (pattern) =>
    new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
      "i",
    ),
);

const objectSchema = z.record(z.string(), z.unknown());
const apiNodeSchema = z.object({ api_node: z.literal(true) });
const apiGraphNodeSchema = z.object({ class_type: z.string().min(1) });
const uiNodeSchema = z.object({ id: z.union([z.string(), z.number()]), type: z.string().min(1) });

function jsonFiles(path) {
  if (!statSync(path).isDirectory()) return [path];

  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const child = join(path, entry.name);

      return entry.isDirectory() ? jsonFiles(child) : entry.name.endsWith(".json") ? [child] : [];
    });
}

// Walk nested subgraphs too: UI exports use nodes[].type; API exports use class_type.
function nodes(value, location = "$", result = []) {
  const array = z.array(z.unknown()).safeParse(value);

  if (array.success) {
    array.data.forEach((item, index) => nodes(item, `${location}[${index}]`, result));

    return result;
  }

  const object = objectSchema.safeParse(value);

  if (!object.success) return result;

  const api = apiGraphNodeSchema.safeParse(object.data);
  const ui = uiNodeSchema.safeParse(object.data);
  const name = api.success ? api.data.class_type : ui.success ? ui.data.type : null;

  if (name) result.push({ name, location, api: apiNodeSchema.safeParse(object.data).success });

  for (const [key, member] of Object.entries(object.data)) {
    nodes(member, `${location}.${key}`, result);
  }

  return result;
}

try {
  const args = process.argv.slice(2);
  const definitionIndex = args.indexOf("--definitions");
  let definitions = {};

  if (definitionIndex !== -1) {
    const definitionFile = args[definitionIndex + 1];

    if (!definitionFile) throw new Error("--definitions requires an object_info JSON file");

    definitions = objectSchema.parse(JSON.parse(readFileSync(definitionFile, "utf8")));
    args.splice(definitionIndex, 2);
  }

  // Every feature's workflows directory, including provenance and UI/subgraph exports.
  const paths = args.length
    ? args
    : readdirSync("src/features", { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `src/features/${entry.name}/workflows`)
        .filter((path) => {
          try {
            return statSync(path).isDirectory();
          } catch {
            return false;
          }
        });

  const files = [...new Set(paths.flatMap(jsonFiles))];
  let scanned = 0;
  let failures = 0;

  for (const file of files) {
    for (const node of nodes(JSON.parse(readFileSync(file, "utf8")))) {
      scanned += 1;

      if (
        node.api ||
        apiNodeSchema.safeParse(definitions[node.name]).success ||
        forbidden.some((pattern) => pattern.test(node.name))
      ) {
        console.error(`${file} ${node.location}: ${node.name} is forbidden (partner/API node)`);
        failures += 1;
      }
    }
  }

  if (scanned === 0) throw new Error("No workflow nodes found; refusing an empty check");

  console.log(`${scanned} nodes scanned in ${files.length} JSON files, ${failures} forbidden`);
  process.exitCode = failures ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
