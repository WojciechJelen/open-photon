# Combined app: integration and real-backend smoke (2026-10-27)

Branch `feat/feature-integration` (worktree `open-photon-wt/feat-feature-integration`), built from
baseline `93ce2bf` plus the shared foundation (`1e9e1b3`…`f22b99a`) and the merges of
`feat/animate-image`, `feat/shots-and-angles`, `feat/character-photoshoot`, `feat/storyboard` and
`feat/product-studio`. Each feature's own ComfyUI gate evidence is in its sibling directory.

## Real-backend smoke (Comfy Cloud, through the integrated app)

`npm run dev` on a fresh database (`IN_FLIGHT_MAX=1`), Comfy Cloud, coordinator render lease held for
the whole run. Every generation was submitted from the app's own pages or routes and reached `done`;
the images and video frames were looked at.

| Workflow | Generations | Submit → done | What was checked |
| --- | --- | --- | --- |
| `image-edit-enhanced` v1 (Photoshoot, Arthur · Editorial) | 4 | 12.6–19.6 s | four poses/lights, same face, glasses, bow tie and suit; one saved to the library |
| `angle-view` v1 (Shots & Angles, Theo) | 2 | 11.3–26.4 s | a real three-quarter turn and a true side profile, outfit stripes kept |
| `storyboard-scenes` v1 (split of a 4-beat sequence) | 1 | 20.7 s | four parseable scenes; scene 4 invented a detail (known limitation) |
| `image-edit` v1 (Storyboard cards, Rosa, Photo) | 4 | 10.3–13.6 s | each card follows its scene; same face and green outfit on all four |
| `product-shot` v1 (Product Studio, Calem bottle, Lifestyle) | 1 | 14.2 s | product pixels and label kept, generated table scene |
| `animate-image` v1 (Photoshoot → Animate handoff, staircase shot) | 1 | 36.3 s | H.264 High / yuv420p, 480×848, 81 frames, 5.06 s; he walks down the stairs, identity kept ([frames](integration-smoke-animate.jpg)) |
| `motion-transfer` v1 (preset Street dance, the character saved from the photoshoot) | 1 | 75.3 s | `video`, `poster` and derived `compare` stored (multi-output finalize regression) |
| `character-generation` v1 | 1 | 29.7 s | one `image` output (multi-output finalize regression) |

15 generations ran one at a time in submission order across five features. Cloud balance
6996.61 → 6972.31 cents: **24.3 ¢** for the whole smoke.

## Combined-app checks performed in a browser (fake provider, `IN_FLIGHT_MAX=1`)

- Navigation: Image menu (Create character, Photoshoot, Shots & Angles, Storyboard, Product Studio),
  Video menu (Motion Transfer, Motion presets, Animate image), seven studio cards.
- Authentication: every new page answers 401 and shows the access-code form without a session;
  `POST /api/{photoshoots,angle-sets,storyboards,product-shots,animations,image-uploads}` and the
  list endpoints answer 401.
- Queue: a photoshoot (4), an angle set (2), an animation and a product shot submitted within a
  second ran strictly in order, one at a time; the animation answered 202 `waiting` at position 7
  and its page showed "Waiting in line".
- Handoffs: Photoshoot shot → Animate and Storyboard card → Animate open `/animate` with that
  generation preselected ("Your result"); the animation's recipe records
  `source: { kind: "generation", generation_id, output: "image" }`. Angle views carry the same
  action.
- Storyboard: a failed split leaves editable cards; regenerating card 2 replaced only card 2's
  generation, and cards 1/3/4 kept theirs across a reload.
- Downloads: image `?download=1` and the MP4 answer `attachment` with the right content type.
- Retries and failure states: covered by each feature's `*.fake.spec.ts` in `npm run test:e2e`.

## Fixed during integration

- An event stream whose own finalize lost a race to another settle (the dispatcher's, or the
  second module instance of `vite dev`) told the page "Comfy is not answering" on a done generation;
  it now ends on the settled snapshot (`tests/stream.test.ts`, fails before / passes after).
- Animate Image's publish link said "image" for a video.
- Four copies of the retry-chain query (batches, photoshoot, angles, storyboard) became one shared
  `findLatestAttempt` (`fallow dupes` flagged them once merged).
- `tests/app.spec.ts` focus-ring test assumed the page's first `data-slot="button"` was within 20 tab
  stops; seven studio cards pushed it past. It now targets the navigation's first category.

## Not verified

Self-host (no pod was started), so peak VRAM and the self-host weight downloads of the new locks
(Qwen-Image-Edit-2511 bf16 ≈ 40.9 GB, Wan 2.2 I2V ≈ 31.3 GB, Qwen3.5 4B ≈ 9.3 GB, BiRefNet ≈ 0.44 GB)
are unmeasured.
