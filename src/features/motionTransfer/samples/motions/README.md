# Sample motions

`manifest.json` lists the clips `seedSampleMotions` (`../../server/samples.ts`) stores as sample
motions, each with its licence, attribution and ffprobe reading. Every sample motion × sample
character is rendered once and marked pre-rendered by `scripts/prerender-samples.mjs`; those takes
fill the home page's result wall.

**Shipped: `street-dance` only.** It is `street_dance_drive.mp4` from Comfy's workflow templates
(MIT). DEV-280 planned two or three more, but no self-filmed or CC0 clip with a licence file was
available when the matrix was rendered (2026-10-23), so the matrix is one motion × six characters.

A clip is added only with a clean licence: self-filmed or CC0, with its licence or release kept
beside the source, audio included, 3–8 s, one person, full body in frame. Add its entry with
`license`, `attribution` and `probe` like `street-dance`, then run the script again: it renders only
the new pairs (one Wan Animate 2 take each, about 17.5 Comfy Cloud credits).
