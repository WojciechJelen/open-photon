# Preset examples

Each preset of [`../catalog.ts`](../catalog.ts) shows one real Motion Transfer render of its own
motion, look and seed with a sample character. The files here are those renders re-encoded for the
page (H.264 High, CRF 26, `+faststart`, AAC 96 kb/s; 480×848, 5.04 s) and a poster cut from each
at 4.4 s. Nothing in them is edited: no crop, no grading, no compositing.

| Preset | Example | Character | Render | Output SHA-256 (`video`) | Latency |
| --- | --- | --- | --- | --- | --- |
| `street-dance` v1 | `street-dance.mp4`, `.jpg` | Maya (sample) | DEV-280 pre-rendered sample take on staging, share page `/r/1f974b0893944ea0`, downloaded from its public `/media/89106cc1-3d1a-4220-926b-877545dbeee5.mp4` | `8ee246f9fb728bc982a7314104517b604189dfb9c25e8eeb7478a45cc2736392` | not recorded (staging run) |
| `neon-night` v1 | `neon-night.mp4`, `.jpg` | Kenji (sample) | Comfy Cloud, 2026-10-23, generation `0e7434c6-cd82-433d-8607-9760a17bc6b9`, recipe hash `287c702e…5257d74` | `a32f2abdcbc273a0da01128bd414947c7413d2fb5d11f838efc743447b012dd3` | 76.4 s |
| `golden-hour-rooftop` v1 | `golden-hour-rooftop.mp4`, `.jpg` | Rosa (sample) | Comfy Cloud, 2026-10-23, generation `9b131eba-292f-401c-be1e-5e4fdb5d25b0`, recipe hash `db8f8165…e5aa529f` | `a3045fa61e10e7d5e6f8a51145d7b1e94634ab5a9e4b28958ab2f1de4a0db754` | 73.6 s |

Every render is `motion-transfer.v1` (Wan Animate 2, `ef8b31e8…a3b1a9`) at 480×848 with the
preset's `defaults` exactly: seed `20261019` and the prompt the catalog lists (the neutral
"…as it appears there. Background as in the reference image." for `street-dance`, the same first
sentence plus the `Neon street at night` or `Golden-hour rooftop` starter phrase of
`src/features/motionTransfer/look.ts` for the other two). Checked by eye at 0.5 s, 2.5 s and
4.5 s: the street-dance take keeps the photo's plain grey background, the neon take puts Kenji on a
night street lit by neon signs, the golden-hour take puts Rosa on a rooftop over a city at sunset;
in all three the character keeps the photo's face and outfit and follows the clip's moves.

The two new takes were submitted through `POST /api/generate` on a local server (one at a time,
`IN_FLIGHT_MAX=1`). Comfy Cloud balance (`summary.balance.amount_cents`,
`GET https://cloud.comfy.org/api/billing/usage/timeseries`): 8036.04 cents at 22:34:19Z, 7978.68
cents at 22:40:45Z, Δ 57.36 cents. Two takes at ≈8.3 cents make ≈16.6 cents; the account served
other jobs in the same window.

## Inputs and licences

- Motion: the `street-dance` sample motion (`street_dance_drive.mp4` from Comfy-Org's
  workflow templates, MIT; `src/features/motionTransfer/samples/motions/`).
- Characters: the Maya, Kenji and Rosa sample characters, FLUX 3 Image Klein renders under the FLUX
  Kommunity License v1.0, reviewed before distribution
  (`src/features/characters/samples/characters/manifest.json`).
- Models: Wan Animate 2 and its encoders, Apache-2.0 (`../../motionTransfer/workflows/models.lock`).

## Commands

```sh
enc() { ffmpeg -y -i "$1" -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 26 -preset slow \
  -movflags +faststart -c:a aac -b:a 96k "$2.mp4"; ffmpeg -y -ss 4.4 -i "$2.mp4" -frames:v 1 -q:v 4 "$2.jpg"; }
enc <street-dance output> street-dance
enc <neon-night output> neon-night
enc <golden-hour output> golden-hour-rooftop
```

Adding a preset: render its motion, look and seed with a sample character, add both files here
and a row above, then its catalog entry; `tests/catalog.test.ts` checks the files exist.
