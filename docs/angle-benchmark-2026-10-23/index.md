# Angle benchmark, 2026-10-23

Does a camera-angle phrasing appended to the Motion Transfer prompt change the camera or the body orientation of the take? **No.** None of nine phrasings, two or more per angle, moved the camera or turned the figure; every take keeps the dancer's orientation of the no-fragment baseline in every frame and follows the clip's camera move. The only framing difference is at 0.5 s, where four takes (both front phrasings and two three-quarter ones) open slightly wider than the baseline; by 2.5 s every take has the baseline's framing. The angle picker, its presets and `angles.json` were removed (DEV-282); the decision is recorded in [`src/features/motionTransfer/workflows/README.md`](../../src/features/motionTransfer/workflows/README.md#angle-presets).

## Setup

- **Workflow:** `motion-transfer.v1.json` (SHA-256 `ef8b31e8…a3b1a9`), Comfy Cloud, 480×848, `fragment_length` 81, the distilled Wan Animate 2 pins of `models.lock`.
- **Motion:** the `street-dance` sample (driving video SHA-256 `affc8c47…0c90bd8`, 5.017 s, 720×1280).
- **Character:** one library character made for this benchmark with the character builder's image workflow (FLUX 3, `character-generation`), generation `9fecc302-8df2-4dc9-9cd3-d6a491cdf805`, seed `20261019`, 768×1344, saved as character `0eb77040-c50f-4746-8e11-cd71c5e4262c` (reference image SHA-256 `600c5ec5…e516bc`): a full-body woman in a yellow hooded jacket with a red backpack on a plain grey background, so a turn of the body shows in the backpack and the jacket's front ([`character.jpg`](character.jpg)).
- **Seed:** `20261019` for every take.
- **Prompt:** the neutral prompt of `workflows/defaults.json` ("The character from the reference image, as it appears there. Background as in the reference image."), then a space and the fragment, as `prepareRecipe` built an angle's prompt. The fragment was sent in `prompt`, so the recipes carry no `angle` member; the graph Comfy received is the one an angle preset would have produced.
- **Stills:** each JPEG is three frames side by side, at 0.5 s, 2.5 s and 4.5 s (`ffmpeg -ss <t> -frames:v 1 -vf scale=240:-2`).
- **SSIM** is ffmpeg's whole-clip SSIM of the take against the baseline (1 = identical). It says how much a fragment perturbs the render, not which way.

## Renders

All ten finished `done`, one at a time, between 16:26:22Z and 16:42:50Z.

| Take | Generation | Recipe hash | Output SHA-256 | Fragment | SSIM | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| [baseline](baseline.jpg) | `7d4e4241-c787-4c71-8075-ba3d3f040030` | `1bd93fb1…74fb63e1` | `b2ed4fc3…` | none | 1 | Reference: the clip's camera (close-up at 0.5 s, pulled back to full body by 2.5 s), the dancer turned away at 2.5 s, facing front at 4.5 s. |
| [front-camera](front-camera.jpg) | `8b85e9ab-ffc5-4a86-8c73-582809243eaa` | `6f31fa2b…9142e064` | `394f8003…` | Shot from the front: the camera faces the character straight on. | 0.868 | Same orientation; wider at 0.5 s (jacket hem and left hand in frame), the baseline's framing from 2.5 s. |
| [front-subject](front-subject.jpg) | `49225948-48cb-4e4c-b10e-a2b4d903203c` | `99baa601…2d427084` | `6c2c109e…` | The character faces the camera and is seen from the front. | 0.879 | Same orientation; wider at 0.5 s (jacket hem and left hand in frame), the baseline's framing from 2.5 s. |
| [three-quarter-camera](three-quarter-camera.jpg) | `493495c1-c5a3-48e4-b374-d256a2c60b12` | `7fe70804…c1ff7d3d` | `a4db7011…` | Shot from a three-quarter angle: the camera is 45 degrees to the character's side. | 0.879 | No turn: frontal at 0.5 s and 4.5 s, as the baseline; wider at 0.5 s (jacket hem and left hand in frame). |
| [three-quarter-subject](three-quarter-subject.jpg) | `2c3c5f41-be08-49f4-9dc2-5ce9eb58abb1` | `2e56dc4c…6e1a449b` | `d8e745df…` | The character's body is turned 45 degrees away from the camera, seen in three-quarter view. | 0.878 | No change: the baseline's chest-up framing at 0.5 s, the body frontal. |
| [three-quarter-placeholder](three-quarter-placeholder.jpg) | `e10c27d2-aa14-450d-976c-14d91cbe40ba` | `64ce388b…23f81a21` | `16de405a…` | Three-quarter view: the camera is turned 45 degrees to the character's side. (the shipped placeholder) | 0.873 | No turn; wider at 0.5 s (jacket hem and left hand in frame). |
| [profile-camera](profile-camera.jpg) | `a374a409-099d-4551-b6a5-5c0ed3ef2136` | `a7afa8db…b703930e` | `a23f58b9…` | Shot from the side, profile view. | 0.880 | No change: no frame shows a side view the baseline does not. |
| [profile-subject](profile-subject.jpg) | `5ef34014-86fe-4b3d-8068-4927ae3a1882` | `b2926e3a…a5f5a255` | `740daf55…` | The character is seen in profile, facing to the side. | 0.907 | No change. |
| [profile-placeholder](profile-placeholder.jpg) | `15e44087-330c-4c38-9998-f3ad045595d9` | `528b3075…14377e7b` | `527aa860…` | Profile view: the camera sees the character from the side. (the shipped placeholder) | 0.892 | No change. |
| [profile-emphatic](profile-emphatic.jpg) | `90995066-3974-48b2-a6b2-07be6c6285a6` | `a7c1f11f…b213cce5` | `2f039b07…` | Side view: the camera stands at the character's left, 90 degrees from the front, so only one side of the body and the face in profile are visible. | 0.919 | No change, even spelled out. |

Every take has its own recipe hash and output, so none was a reused result. The motion transferred in all ten. The two front fragments, which ask for what the clip already shows, move the render as much (SSIM 0.868, 0.879) as the three-quarter and profile ones (0.873 to 0.919), and they open as wide at 0.5 s as the two three-quarter takes that do: the differences are seed-level noise in detail and in the first second's framing, not a camera angle or a turn.

## Why

Wan Animate 2 renders the character onto the driving video's pose, frame by frame: `WanAnimate2ToVideo` takes the skeleton extracted from the clip as `pose_video`, and the clip's camera move and the dancer's facing come with it. The text prompt (`positive`) conditions appearance; none of the node's inputs lets it move the camera or turn the skeleton, and the renders above show it does not. Changing the angle would mean restaging the driving video in 3D, which the ideation report rejected.

## Cost

One character image and ten 5 s takes. Balance (`summary.balance.amount_cents` of `GET https://cloud.comfy.org/api/billing/usage/timeseries`) 8293.468800 cents at 16:24:26Z, 8199.816491 cents at 16:42:59Z: Δ 93.65 cents. Ten takes at ≈8.3 cents (`CHECKLIST.md` 1.6) and the image at ≈0.8 cents make ≈83.9 cents; the rest is another task's render on the same account in the same window.
