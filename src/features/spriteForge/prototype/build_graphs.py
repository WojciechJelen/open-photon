"""Writes the Sprite Forge prototype's API graphs into `graphs/` (standard library only).

- `directions.api.json` (Comfy Cloud): five camera azimuths of one character, `angle-view.v1`
  (Qwen-Image-Edit-2511 + the fal Multiple-Angles LoRA) with one branch per direction.
- `walk.api.json` (Comfy Cloud): one direction view on a flat grey background, animated by
  Wan 2.2 14B image-to-video with the view as both first and last frame (a closed loop), then
  matted by BiRefNet and saved as RGBA PNG frames plus an MP4 preview. `walk-back.api.json` is
  the same with a prompt that keeps a back view facing away; `walk-open.api.json` drops the last
  frame (the comparison that showed why the loop is closed).
- `sheet.api.json` (local ComfyUI with `comfy_nodes/sprite_forge`): the Sprite Forge nodes turn
  the matted frames of every direction into an HD atlas and a pixel-art atlas.

    python3 src/features/spriteForge/prototype/build_graphs.py
    npx oxfmt src/features/spriteForge/prototype/graphs
"""

import copy
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
FEATURES = HERE.parents[1]
OUT = HERE / "graphs"

# The Multiple-Angles LoRA's own vocabulary (`<sks> <azimuth> <elevation> <distance>`). "medium
# shot" keeps a full-body reference full body (docs/feature-evidence/shots-and-angles/).
DIRECTIONS = {
    "s": "<sks> front view eye-level shot medium shot",
    "se": "<sks> front-right quarter view eye-level shot medium shot",
    "e": "<sks> right side view eye-level shot medium shot",
    "ne": "<sks> back-right quarter view eye-level shot medium shot",
    "n": "<sks> back view eye-level shot medium shot",
}

WALK_PROMPT = (
    "A full-body character walks in place on the spot in a smooth, looping walk cycle: the legs "
    "step alternately and the arms swing naturally. The character stays in the same place in the "
    "frame, does not move forward and does not turn. Static camera, locked-off shot, plain grey "
    "studio background, even lighting."
)
# The north (back) clip with WALK_PROMPT turned the character to the camera mid-clip (Cloud job
# 6c1f8e94); this one says the back stays to the camera.
WALK_PROMPT_BACK = (
    "Seen from behind: a full-body character with their back to the camera walks in place on the "
    "spot in a smooth, looping walk cycle, the legs stepping alternately and the arms swinging. "
    "The character faces away from the camera the whole time and never turns around, never "
    "shows the face, and stays in the same place in the frame. Static camera, locked-off shot, "
    "plain grey studio background, even lighting."
)

WALK_WIDTH, WALK_HEIGHT, WALK_FRAMES, WALK_FPS = 480, 832, 49, 16
BACKGROUND_GREY = 0xB4B4B4

# The local sheet: eight directions from five clips. Every turned view the Multiple-Angles LoRA
# drew for Kenji faces screen-left (south-west, west, north-west), so the east side is their
# mirror image. Folders are under the local ComfyUI's input directory.
SHEET_ROWS = [
    ("walk_s", "sprite-forge/kenji/walk-s", False),
    ("walk_sw", "sprite-forge/kenji/walk-sw", False),
    ("walk_w", "sprite-forge/kenji/walk-w", False),
    ("walk_nw", "sprite-forge/kenji/walk-nw", False),
    ("walk_n", "sprite-forge/kenji/walk-n", False),
    ("walk_ne", "sprite-forge/kenji/walk-nw", True),
    ("walk_e", "sprite-forge/kenji/walk-w", True),
    ("walk_se", "sprite-forge/kenji/walk-sw", True),
]


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def directions_graph() -> dict:
    base = load(FEATURES / "angles/workflows/angle-view.v1.json")
    shared = {k: v for k, v in base.items() if k not in {"151", "148", "169", "158", "2"}}
    graph = copy.deepcopy(shared)
    for index, (name, prompt) in enumerate(DIRECTIONS.items()):
        offset = 1000 * (index + 1)
        ids = {old: str(offset + int(old)) for old in ("151", "148", "169", "158", "2")}
        for old, new in ids.items():
            node = copy.deepcopy(base[old])
            for field, value in node["inputs"].items():
                if isinstance(value, list) and value[0] in ids:
                    node["inputs"][field] = [ids[value[0]], value[1]]
            graph[new] = node
        graph[ids["151"]]["inputs"]["prompt"] = prompt
        graph[ids["169"]]["inputs"]["seed"] = 20261029
        graph[ids["2"]]["inputs"]["filename_prefix"] = f"sprite-forge/view-{name}"
    return graph


def walk_graph(end_frame: bool, prompt: str = WALK_PROMPT) -> dict:
    base = load(FEATURES / "animateImage/workflows/animate-image.v1.json")
    graph = {k: copy.deepcopy(v) for k, v in base.items() if k != "6"}
    graph["4"]["inputs"]["text"] = prompt
    graph["13"]["inputs"]["noise_seed"] = 20261029
    # The view on flat grey at the clip's size, so Wan animates the character, not a background.
    graph["20"] = {
        "class_type": "ImageScale",
        "inputs": {
            "image": ["1", 0],
            "upscale_method": "lanczos",
            "width": WALK_WIDTH,
            "height": WALK_HEIGHT,
            "crop": "center",
        },
    }
    graph["21"] = {
        "class_type": "LoadBackgroundRemovalModel",
        "inputs": {"bg_removal_name": "birefnet.safetensors"},
    }
    graph["22"] = {
        "class_type": "RemoveBackground",
        "inputs": {"bg_removal_model": ["21", 0], "image": ["20", 0]},
    }
    graph["23"] = {
        "class_type": "EmptyImage",
        "inputs": {
            "width": WALK_WIDTH,
            "height": WALK_HEIGHT,
            "batch_size": 1,
            "color": BACKGROUND_GREY,
        },
    }
    graph["24"] = {
        "class_type": "ImageCompositeMasked",
        "inputs": {
            "destination": ["23", 0],
            "source": ["20", 0],
            "x": 0,
            "y": 0,
            "resize_source": False,
            "mask": ["22", 0],
        },
    }
    flf = {
        "positive": ["4", 0],
        "negative": ["5", 0],
        "vae": ["3", 0],
        "width": WALK_WIDTH,
        "height": WALK_HEIGHT,
        "length": WALK_FRAMES,
        "batch_size": 1,
        "start_image": ["24", 0],
    }
    if end_frame:
        flf["end_image"] = ["24", 0]
    graph["6"] = {"class_type": "WanFirstLastFrameToVideo", "inputs": flf}
    graph["16"]["inputs"]["fps"] = WALK_FPS
    graph["17"]["inputs"]["filename_prefix"] = "sprite-forge/walk"
    # Matte every frame; JoinImageWithAlpha takes an inverted mask (1 = transparent).
    graph["31"] = {
        "class_type": "RemoveBackground",
        "inputs": {"bg_removal_model": ["21", 0], "image": ["15", 0]},
    }
    graph["32"] = {"class_type": "InvertMask", "inputs": {"mask": ["31", 0]}}
    graph["33"] = {
        "class_type": "JoinImageWithAlpha",
        "inputs": {"image": ["15", 0], "alpha": ["32", 0]},
    }
    graph["34"] = {
        "class_type": "SaveImage",
        "inputs": {"images": ["33", 0], "filename_prefix": "sprite-forge/frame"},
    }
    return graph


def sheet_graph(rows: list[tuple[str, str, bool]]) -> dict:
    """`rows`: (direction name, frames directory under ComfyUI's input dir, flip)."""
    graph: dict = {}
    previous = None
    sources: dict[str, tuple[str, str]] = {}
    for index, (name, directory, flip) in enumerate(rows):
        if directory not in sources:
            n = 100 + 10 * len(sources)
            graph[str(n)] = {"class_type": "SpriteFramesLoad", "inputs": {"directory": directory}}
            graph[str(n + 1)] = {
                "class_type": "SpriteLoopCut",
                "inputs": {
                    "frames": [str(n), 0],
                    "mask": [str(n), 1],
                    "min_frames": 10,
                    "max_frames": 32,
                    "frame_count": 8,
                },
            }
            graph[str(n + 2)] = {
                "class_type": "SpritePivotLock",
                "inputs": {
                    "frames": [str(n + 1), 0],
                    "mask": [str(n + 1), 1],
                    "cell_width": 128,
                    "cell_height": 160,
                    "fill": 0.92,
                    "alpha_threshold": 0.5,
                },
            }
            sources[directory] = (str(n + 2), str(n + 1))
        pivot, loop_cut = sources[directory]
        row_id = str(500 + index)
        inputs = {
            "frames": [pivot, 0],
            "mask": [pivot, 1],
            "pivot_x": [pivot, 2],
            "pivot_y": [pivot, 3],
            "name": name,
            "flip_horizontal": flip,
            "seam_ratio": [loop_cut, 4],
            "take": [loop_cut, 5],
        }
        if previous is not None:
            inputs["rows"] = [previous, 0]
        graph[row_id] = {"class_type": "SpriteRow", "inputs": inputs}
        previous = row_id
    save_atlas(graph, "900", previous, "hd")
    graph["910"] = {
        "class_type": "SpriteRescale",
        "inputs": {"rows": [previous, 0], "cell_width": 48, "cell_height": 60},
    }
    graph["911"] = {
        "class_type": "SpritePalette",
        "inputs": {"rows": ["910", 0], "colors": 24, "outline": True, "alpha_threshold": 0.5},
    }
    save_atlas(graph, "920", "911", "pixel")
    return graph


def save_atlas(graph: dict, node_id: str, rows: str, name: str) -> None:
    """`SpriteAtlasPack` at `node_id`, its PNG and JSON saved by the core nodes at the next ids."""
    pack_id, image_id, text_id = node_id, str(int(node_id) + 1), str(int(node_id) + 2)
    graph[pack_id] = {
        "class_type": "SpriteAtlasPack",
        "inputs": {"rows": [rows, 0], "fps": 10, "image_name": f"{name}.png"},
    }
    graph[image_id] = {
        "class_type": "SaveImage",
        "inputs": {"images": [pack_id, 0], "filename_prefix": f"sprite-forge/{name}"},
    }
    graph[text_id] = {
        "class_type": "SaveText",
        "inputs": {
            "text": [pack_id, 1],
            "filename_prefix": f"sprite-forge/{name}",
            "format": "txt",
        },
    }


def write(name: str, graph: dict) -> None:
    path = OUT / name
    path.write_text(json.dumps(graph, indent=2) + "\n")
    print(f"wrote {path.relative_to(HERE)} ({len(graph)} nodes)")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    write("directions.api.json", directions_graph())
    write("walk.api.json", walk_graph(end_frame=True))
    write("walk-back.api.json", walk_graph(end_frame=True, prompt=WALK_PROMPT_BACK))
    write("walk-open.api.json", walk_graph(end_frame=False))
    write("sheet.api.json", sheet_graph(SHEET_ROWS))
