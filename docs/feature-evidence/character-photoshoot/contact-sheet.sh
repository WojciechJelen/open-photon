#!/usr/bin/env bash
# Builds a downscaled JPEG contact sheet: the reference, then each case's output, side by side at
# one height, in the order given (this ffmpeg has no drawtext; the README names each panel).
#   bash docs/feature-evidence/character-photoshoot/contact-sheet.sh <out.jpg> <reference.png> <case dir>...
set -euo pipefail
out=$1 reference=$2
shift 2
inputs=(-i "$reference")
filters="[0]scale=-2:480[v0];"
n=1
for dir in "$@"; do
  png=$(ls "$dir"/*.png | head -1)
  inputs+=(-i "$png")
  filters+="[$n]scale=-2:480[v$n];"
  n=$((n + 1))
done
for ((i = 0; i < n; i++)); do filters+="[v$i]"; done
filters+="hstack=inputs=$n"
ffmpeg -v error -y "${inputs[@]}" -filter_complex "$filters" -q:v 5 "$out"
ls -l "$out"
