# README visuals

The two images at the top of the [project README](../../README.md), cut with FFmpeg 8.0.1 from
DEV-280's pre-rendered sample take of Maya (Comfy Cloud, generation
`09b487e6-8fa7-4c27-97ee-5c7b36ddf5a0`: the Street dance sample × the Maya sample character).

| File | What it shows | Size | SHA-256 |
| --- | --- | --- | --- |
| `maya-character-and-take.jpg` | Left: the Maya sample character as FLUX 3 Image Klein rendered it. Right: the take's frame at 2.0 s, Wan Animate 2 moving her to the clip | 980×848, 79,510 bytes | `f6be097713c8e4adf8ce7c03be26ffe73810789a18af24b82d5e03567d002c8b` |
| `maya-street-dance.gif` | The take's `compare` output (DEV-283): driving clip left, result right, 5 s, looped; cropped to the picture (the 9:16 frame's black bars removed), 10 fps, 128 colours | 600×530, 50 frames, 6,246,036 bytes | `eb6bce16572e63fb967bc1b3862b0a696ebf45c415d01072587a54b435193a4c` |

## Inputs

| Input | Where it is | SHA-256 |
| --- | --- | --- |
| Character image (768×1344) | [`src/features/characters/samples/characters/maya.png`](../../src/features/characters/samples/characters/maya.png) | `51f9f35a41d58a9ae8c3f9561024700480615407939c6c1fe84c6383da2c1479` |
| `maya-video.mp4`: the take's `video` output (480×848, 5.017 s, 121 frames) | not in the repository; exported from the DEV-280 database | `1d1ea7894052a3a5b540c2c15b512dc9908110458ce41f9d4b87e3083f576853` |
| `maya-compare.mp4`: the take's `compare` output (1080×1920, 5.017 s) | not in the repository; exported from the DEV-280 database | `8164742f681e5b3c8c66791ae86783b8a134d1ce6a1fad7e63fc4fe94b9ed73e` |

The driving clip in the GIF's left half is the
[`street-dance`](../../src/features/motionTransfer/samples/motions/README.md) sample (MIT, Comfy's
workflow templates).

## Commands

From the repository root, with `SRC` the folder holding the two exported outputs:

```sh
# Still: the character, a 16 px white gap, then the take's frame at 2.0 s, both 848 px tall.
ffmpeg -y -i src/features/characters/samples/characters/maya.png -ss 2 -i "$SRC/maya-video.mp4" \
  -filter_complex "[0:v]scale=-2:848:flags=lanczos,setsar=1,pad=iw+16:ih:0:0:white[c];[1:v]setsar=1[t];[c][t]hstack=inputs=2" \
  -frames:v 1 -q:v 2 docs/readme/maya-character-and-take.jpg

# GIF: crop the 1080×954 picture out of the 1080×1920 frame, 10 fps, 600 px wide, one palette.
ffmpeg -y -i "$SRC/maya-compare.mp4" \
  -filter_complex "[0:v]crop=1080:954:0:483,fps=10,scale=600:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 docs/readme/maya-street-dance.gif
```

`crop=1080:954:0:483` is the picture `compare` stitches: the 960×848 pair scaled to 1080 wide is
954 tall and centred on 1920 (`src/features/motionTransfer/server/media/compare.ts`);
`cropdetect` found the same band.
