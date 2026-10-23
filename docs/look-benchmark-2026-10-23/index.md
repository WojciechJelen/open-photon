# Look benchmark, 2026-10-23

Does a look fragment appended to the Motion Transfer prompt change the take? **A background does; lighting and color/style do not, visibly.** Both background fragments (a neon street at night, a sunny beach) replaced the photo's grey backdrop for the whole clip and brought their own light with it (the neon street darkens the take from a mean luma of 127.9 to 69.6). A third background, a white studio, asked for nearly what the photo already shows and changed nothing. None of the three lighting and three color/style fragments moved the take's light or color: their mean luma (127.2–128.2) and saturation (12.3–12.6) match the baseline's (127.9, 12.6), and even "black-and-white film noir" stays in full color. The looks editor (DEV-291, `src/features/looks/`) therefore offers the two backgrounds as they are and the lighting and color/style options marked **Experimental**, with this result written under them; the white studio is not offered. No option claims camera control: the [angle benchmark](../angle-benchmark-2026-10-23/index.md) showed the prompt cannot move the camera.

## Setup

- **Workflow:** `motion-transfer.v1.json` (SHA-256 `ef8b31e8…a3b1a9`), Comfy Cloud, 480×848, `fragment_length` 81, the distilled Wan Animate 2 pins of `models.lock`.
- **Motion:** the `street-dance` sample (driving video SHA-256 `affc8c47…0c90bd8`, 5.017 s, 720×1280).
- **Character:** the `maya` sample character ([`maya.png`](../../src/features/characters/samples/characters/maya.png), reference image SHA-256 `51f9f35a…da2c1479`): a full-body woman in a mustard hoodie and black cargo trousers on a plain warm-grey backdrop.
- **Seed:** `20261019` (the `defaults.json` seed) for every take.
- **Prompt:** exactly what the looks editor composes for one pick and a blank description (`composeLook`, `src/features/looks/compose.ts`): `The character from the reference image, as it appears there.`, then `Background as in the reference image.` unless the pick is a background, then the fragment. The baseline is a blank look, which sends the `defaults.json` prompt, the same two leading sentences without a fragment.
- **Submitted** through `POST /api/generate` of this branch's dev server with the real provider, between 22:33:31Z and 22:35:53Z (the generate rate limit spaced the requests); the dispatcher (`IN_FLIGHT_MAX=1`) ran them one at a time, in that order.
- **Stills:** each JPEG is three frames side by side, at 0.5 s, 2.5 s and 4.5 s (`ffmpeg -ss <t> -frames:v 1 -vf scale=240:-2`). The editor's background tile previews (`src/features/looks/previews/`) are the 4.5 s frame of that option's take, cropped to 4:5 (`crop=480:600:0:124,scale=288:360`).
- **SSIM** is ffmpeg's whole-clip SSIM of the take against the baseline (1 = identical): how much the fragment perturbs the render, not which way. **Luma** and **Sat** are ffmpeg `signalstats` YAVG and SATAVG, averaged over every frame: they move when the light or the color of the whole take changes.

## Renders

All ten finished `done`, one at a time, between 22:33:33Z and 22:47:38Z. Latency is from the submit starting to the take being stored.

| Take | Generation | Recipe hash | Output SHA-256 | Fragment | Latency | SSIM | Luma | Sat | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [baseline](baseline.jpg) | `84099c0a-7080-4a85-a103-ee5812345c01` | `cec7578d…3631637c` | `f3c04c1b…` | none | 75.8 s | 1 | 127.9 | 12.6 | Reference: the photo's warm-grey backdrop, close-up at 0.5 s, full body by 2.5 s. |
| [neon-street](neon-street.jpg) | `029f4311-c3aa-4b81-94f9-a5d5743a9383` | `dcb8eae8…e7531c72` | `370bc11b…` | Background: a neon-lit city street at night, wet pavement reflecting pink and blue signs. | 119.8 s | 0.551 | 69.6 | 16.2 | **Works.** A night street with pink and cyan signs on wet asphalt in every frame; the character, outfit and motion kept. Offered. |
| [beach](beach.jpg) | `7818d24e-ddcc-4194-bef0-2e356f2df96e` | `7cf49fde…21873e74` | `6c052b1d…` | Background: a sunny sandy beach with the blue sea and sky behind. | 74.0 s | 0.829 | 143.5 | 21.2 | **Works.** Sand, surf and blue sky in every frame, brighter and bluer; the character kept. Offered. |
| [white-studio](white-studio.jpg) | `2c780e3b-459f-44a0-b55b-8e69c70cab09` | `4bcdcc99…801e2c1c` | `3baa6696…` | Background: a bright seamless white studio cyclorama. | 70.8 s | 0.913 | 128.1 | 12.1 | **No change.** The backdrop stays the photo's warm grey (the 0.5 s frame opens wider, full body, seed-level framing noise as in the angle benchmark). Not offered. |
| [golden-hour](golden-hour.jpg) | `9bf98b81-a355-48f9-b227-cbec2ce5c956` | `803344b7…7089f143` | `a176d28a…` | Lighting: warm golden-hour sunlight from a low angle, long soft shadows. | 71.9 s | 0.926 | 128.0 | 12.6 | No visible change: no warm cast, no long shadows. Experimental. |
| [low-key](low-key.jpg) | `5963fe7c-8acc-42dc-bc4e-faff3365c84c` | `e47fa8e3…c4d97248` | `b8ab013f…` | Lighting: dramatic low-key light from one side, deep shadows. | 69.7 s | 0.912 | 127.8 | 12.6 | No visible change: the even studio light of the photo. Experimental. |
| [neon-glow](neon-glow.jpg) | `8baad286-14eb-4a17-b02d-27823f53fced` | `c0a71f61…d9e2cbf9` | `49825a62…` | Lighting: magenta and cyan neon light on the character. | 71.0 s | 0.891 | 127.2 | 12.5 | No visible change: no colored light on the hoodie or skin. Experimental. |
| [noir](noir.jpg) | `c76599eb-ac8b-4a3f-ba3c-9e0ead6a8e7c` | `de36cd4a…1fe50a58` | `83dcdd1e…` | Look: black-and-white film noir, high contrast. | 83.1 s | 0.921 | 127.9 | 12.4 | No visible change: full color, the baseline's contrast. Experimental. |
| [vintage-film](vintage-film.jpg) | `8d7a9893-687d-49b1-ac66-dfa603c12668` | `648938a7…e1edadb5` | `5e3e530c…` | Look: warm vintage 35 mm film, soft grain, faded colors. | 117.3 s | 0.908 | 128.2 | 12.3 | No visible change in color or grain (the 0.5 s frame opens wider, full body, seed-level framing noise). Experimental. |
| [teal-orange](teal-orange.jpg) | `db374461-c58d-4408-a1d0-330c20e0ce5b` | `0a78911e…5311d0d1` | `63c48a16…` | Look: cinematic teal-and-orange color grade. | 73.1 s | 0.931 | 128.0 | 12.6 | No visible change: no grade. Experimental. |

Every take has its own recipe hash and output, so none was a reused result. The motion transferred in all ten, and the character (face, braids, hoodie, trousers, sneakers) is the photo's in all ten.

One confound: the `street-dance` clip is itself filmed on a neon-lit street at night, and the graph feeds the model the clip's frames (`pose_video`, node `672:600`) and the CLIP vision embedding of its first frame (`clip_vision_output_pose`, node `672:598`). The neon-street take may borrow its street from the clip; the baseline, whose prompt keeps the photo's backdrop, shows the clip alone does not put the street there. The beach take, a scene the clip does not contain, shows the background comes from the prompt. A clip filmed elsewhere was not tested.

## Why

`WanAnimate2ToVideo` draws the character of the reference image onto the driving clip's pose; the text prompt (`positive`) conditions the scene. The template's own prompt is written as a character description and a background description, and a background description is what moved the render: with it the model paints a new scene, light included. A lighting or color phrase on top of "Background as in the reference image." competes with the reference image, which already fixes the light and the colors of the character and the backdrop, and loses. Whether a lighting phrase works *together with* a background change was not tested (the budget was ten takes); until a benchmark shows it, those options stay experimental.

## What the editor does with this

- **Backgrounds** (Neon street, Sunny beach): offered without a caveat, as tiles whose preview is the 4.5 s frame of the option's take.
- **Lighting** (Golden hour, Low-key, Neon glow) and **Color & style** (Noir, Vintage film, Teal and orange): offered as plain chips without a preview (their takes look like the baseline) under an **Experimental** badge, with "In our benchmark these did not visibly change the take" under the group heading; each chip's accessible description says it too.
- **White studio:** removed.
- **Camera:** no control is offered; the editor says the camera, framing and pose follow the motion clip.

## Cost

Ten 5 s takes. Balance (`summary.balance.amount_cents` of `GET https://cloud.comfy.org/api/billing/usage/timeseries`) 8036.039327 cents at 22:31:35Z, 7936.925958 cents at 22:47:46Z: Δ 99.11 cents. Ten takes at ≈8.3 cents make ≈83 cents; the rest is other renders on the same account in the same window (other branches were benchmarking at the time).
