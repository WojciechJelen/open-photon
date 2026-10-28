#!/usr/bin/env bash
# The photoshoot gate's cases (MODEL, default klein3pe: FLUX 3 Klein distilled edit with its prompt upsampler), one render at a time through the
# coordinator's runner. Each character gets every setting once, at a different shot, so the 20
# renders cover all 16 shots of the catalog; `maya` also gets one complete four-shot session.
# Run from the worktree root: bash docs/feature-evidence/character-photoshoot/run-cases.sh
set -u
cd "$(dirname "$0")/../../.."
V=${PROMPT_VERSION:-p3}
M=${MODEL:-klein3pe}
run() { bash docs/feature-evidence/character-photoshoot/run-case.sh "$M" "$@" || echo "FAILED: $*"; }
S=src/features/characters/samples/characters
PHOTO=work/feature-evidence/character-photoshoot/inputs/photo-ref/9-0-image_flux3_klein_distilled_t2i_00001_.png
settings=(studio street editorial outdoors)
# Each character's shot offset i: setting s renders shot (i + s) % 4. Stylized first.
for entry in yuki:1 photo:3 cyborg:2 arthur:0; do
  character=${entry%%:*} i=${entry##*:}
  case $character in
    cyborg) ref=fixtures/wan/reference.png ;;
    photo) ref=$PHOTO ;;
    *) ref=$S/$character.png ;;
  esac
  for s in 0 1 2 3; do
    shot=$(((i + s) % 4))
    out=work/feature-evidence/character-photoshoot/$M-$V/$character-${settings[$s]}-$shot
    [ -f "$out/run.json" ] && grep -q '"succeeded"' "$out/run.json" && continue
    run "$character" "$ref" "${settings[$s]}" "$shot"
  done
done
for shot in 0 1 2 3; do
  out=work/feature-evidence/character-photoshoot/$M-$V/maya-street-$shot
  [ -f "$out/run.json" ] && grep -q '"succeeded"' "$out/run.json" && continue
  run maya "$S/maya.png" street "$shot"
done
