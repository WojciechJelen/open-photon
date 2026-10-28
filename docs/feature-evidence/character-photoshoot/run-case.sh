#!/usr/bin/env bash
# Runs one photoshoot evidence case through the coordinator's runner (render lease + our SDK provider):
#   bash docs/feature-evidence/character-photoshoot/run-case.sh <model> <character> <reference.png> <setting> <shot 0-3> [seed]
# <model>: klein3 (graphs/klein3-edit.api.json), klein3pe (FLUX 3 prompt upsampler first,
# Foundation's flux3-klein-edit-pe.api.json), qwen2511 (Foundation's qwen-edit-2511.api.json, int8, 40 steps). The prompt is the app's own
# (`compileShotPrompt` of src/features/photoshoot/settings.ts); the seed defaults to 1001 + shot.
# Output: work/feature-evidence/character-photoshoot/<model>-<prompt version>/<character>-<setting>-<shot>/
# PROMPT_VERSION (default p3) only names the directory: the prompt is whatever settings.ts compiles.
set -euo pipefail
cd "$(dirname "$0")/../../.."
C=/Users/wojciechjelen/workspace/comfy-challenge/open-photon-wt/feature-coord
model=$1 character=$2 reference=$3 setting=$4 shot=$5 seed=${6:-$((1001 + $5))}
case $model in
  klein3) graph=klein3-edit.api.json prompt_field=4.text seed_field=7.seed image_node=11 ;;
  klein3pe) graph=flux3-klein-edit-pe.api.json prompt_field=47.prompt seed_field=7.seed image_node=11 ;;
  qwen2511) graph=qwen-edit-2511.api.json prompt_field=170:151.prompt seed_field=170:169.seed image_node=41 ;;
  *) echo "unknown model $model" >&2; exit 2 ;;
esac
prompt=$(node --experimental-strip-types --input-type=module -e \
  "import { compileShotPrompt } from './src/features/photoshoot/settings.ts'; process.stdout.write(compileShotPrompt('$setting', $shot));")
node --experimental-strip-types "$C/comfy-run.ts" --repo "$PWD" --owner character-photoshoot \
  --label "$model-${PROMPT_VERSION:-p3}-$character-$setting-$shot" \
  --graph "docs/feature-evidence/character-photoshoot/graphs/$graph" \
  --out "work/feature-evidence/character-photoshoot/$model-${PROMPT_VERSION:-p3}/$character-$setting-$shot" \
  --image "$image_node=$(cd "$(dirname "$reference")" && pwd)/$(basename "$reference")" \
  --set "$prompt_field=$prompt" --set "$seed_field=$seed"
