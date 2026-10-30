"""Writes Sprite Forge's runtime workflows and their inputs maps (standard library only).

- `sprite-view.v1.json`: one direction view of a library character, `angle-view.v1` of Shots &
  Angles (Qwen-Image-Edit-2511 + the fal Multiple-Angles LoRA) saved under its own prefix.
- `sprite-sheet.v1.json`: five views into an 8-direction walk-cycle sheet in one graph. Per
  direction, Wan 2.2 i2v walks the view in place (first frame = last frame) in up to three takes,
  BiRefNet mattes the frames, and the Sprite Forge custom nodes keep the cleanest loop, lock the
  pivot, mirror the east side and pack an HD and a pixel-art atlas with their Aseprite JSON.

Node ids of the sheet follow one rule so the server can prune takes 2 and 3 by id alone:
shared nodes are 1-999; direction `d` (1..5 in `spriteDirections` order) owns `d * 1000 + 1..99`
for its take-independent nodes and `d * 1000 + t * 100 + 1..99` for take `t` (1..3).

    python3 src/features/spriteForge/workflows/build_workflows.py
    npx oxfmt src/features/spriteForge/workflows
"""

import copy
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
FEATURES = HERE.parents[1]

VIEW_WORKFLOW = "sprite-view.v1.json"
SHEET_WORKFLOW = "sprite-sheet.v1.json"

# `spriteDirections` and `sheetRows` of `contracts.ts`, in their order.
DIRECTIONS = ["s", "sw", "w", "nw", "n"]
SHEET_ROWS = ["s", "sw", "w", "nw", "n", "ne", "e", "se"]
# The direction whose clip each row shows: the east side mirrors the turned views.
ROW_SOURCES = {"ne": "nw", "e": "w", "se": "sw"}
# The rows the server may flip, bound to `flip_<row>`; south and north are symmetric enough as
# drawn and are never mirrored.
FLIPPABLE_ROWS = ["sw", "w", "nw", "ne", "e", "se"]
TAKES = [1, 2, 3]

# The prototype's prompts (`prototype/build_graphs.py`), validated on Comfy Cloud.
WALK_PROMPT = (
    "A full-body character walks in place on the spot in a smooth, looping walk cycle: the legs "
    "step alternately and the arms swing naturally. The character stays in the same place in the "
    "frame, does not move forward and does not turn. Static camera, locked-off shot, plain grey "
    "studio background, even lighting."
)
# With WALK_PROMPT the north clip turned the character to the camera mid-clip; this one keeps
# the back to the camera (src/features/spriteForge/README.md, "Back view").
WALK_PROMPT_BACK = (
    "Seen from behind: a full-body character with their back to the camera walks in place on the "
    "spot in a smooth, looping walk cycle, the legs stepping alternately and the arms swinging. "
    "The character faces away from the camera the whole time and never turns around, never "
    "shows the face, and stays in the same place in the frame. Static camera, locked-off shot, "
    "plain grey studio background, even lighting."
)

WALK_WIDTH, WALK_HEIGHT, WALK_FRAMES = 480, 832, 49
BACKGROUND_GREY = 0xB4B4B4

# Shared node ids of the sheet. The Wan loaders keep their ids from `animate-image.v1.json`.
CLIP, VAE, PROMPT, NEGATIVE, PROMPT_BACK = "2", "3", "4", "5", "6"
UNET_HIGH, LORA_HIGH, MODEL_HIGH = "7", "8", "9"
UNET_LOW, LORA_LOW, MODEL_LOW = "10", "11", "12"
MATTE_MODEL, BACKGROUND = "21", "23"
HD_PACK, HD_IMAGE, HD_JSON = "910", "911", "912"
PIXEL_RESCALE, PIXEL_PALETTE, PIXEL_PACK, PIXEL_IMAGE, PIXEL_JSON = (
    "920",
    "921",
    "922",
    "923",
    "924",
)

# Per-direction offsets from `d * 1000`.
VIEW, SCALED, VIEW_MATTE, COMPOSITE, LOOP_CUT, PIVOT_LOCK = 1, 2, 3, 4, 5, 6
# Per-take offsets from `d * 1000 + t * 100`.
CONDITIONING, SAMPLER_HIGH, SAMPLER_LOW, DECODE, FRAMES_MATTE = 1, 2, 3, 4, 5

# Every class the sheet uses with its required inputs: the core nodes as ComfyUI 0.42.0 defines
# them, the Sprite Forge nodes as `comfy_nodes/sprite_forge/nodes.py` does. API format carries
# every widget value, so a node missing one is refused at submit.
REQUIRED_INPUTS = {
    "CLIPLoader": ["clip_name", "type"],
    "VAELoader": ["vae_name"],
    "CLIPTextEncode": ["text", "clip"],
    "UNETLoader": ["unet_name", "weight_dtype"],
    "LoraLoaderModelOnly": ["model", "lora_name", "strength_model"],
    "ModelSamplingSD3": ["model", "shift"],
    "LoadBackgroundRemovalModel": ["bg_removal_name"],
    "RemoveBackground": ["bg_removal_model", "image"],
    "EmptyImage": ["width", "height", "batch_size", "color"],
    "LoadImage": ["image"],
    "ImageScale": ["image", "upscale_method", "width", "height", "crop"],
    "WanFirstLastFrameToVideo": [
        "positive",
        "negative",
        "vae",
        "width",
        "height",
        "length",
        "batch_size",
    ],
    "ImageCompositeMasked": ["destination", "source", "x", "y", "resize_source"],
    "KSamplerAdvanced": [
        "model",
        "add_noise",
        "noise_seed",
        "steps",
        "cfg",
        "sampler_name",
        "scheduler",
        "positive",
        "negative",
        "latent_image",
        "start_at_step",
        "end_at_step",
        "return_with_leftover_noise",
    ],
    "VAEDecode": ["samples", "vae"],
    "SpriteLoopCut": ["frames", "mask", "min_frames", "max_frames", "frame_count"],
    "SpritePivotLock": ["frames", "mask", "cell_width", "cell_height", "fill", "alpha_threshold"],
    "SpriteRow": ["frames", "mask", "pivot_x", "pivot_y", "name", "flip_horizontal"],
    "SpriteRescale": ["rows", "cell_width", "cell_height"],
    "SpritePalette": ["rows", "colors", "outline", "alpha_threshold"],
    "SpriteAtlasPack": ["rows", "fps", "image_name"],
    "SaveImage": ["images", "filename_prefix"],
    "SaveText": ["text", "filename_prefix", "format"],
}

# The optional inputs a class may also carry; any other input name is a mistake.
OPTIONAL_INPUTS = {
    "CLIPLoader": ["device"],
    "ImageCompositeMasked": ["mask"],
    "WanFirstLastFrameToVideo": ["start_image", "end_image"],
    "SpriteLoopCut": ["frames_2", "mask_2", "frames_3", "mask_3"],
    "SpriteRow": ["rows", "seam_ratio", "take"],
}

# The take inputs of `SpriteLoopCut` the server deletes when a sheet renders one take.
LOOP_CUT_TAKE_INPUTS = {2: ["frames_2", "mask_2"], 3: ["frames_3", "mask_3"]}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def link(node: str | int, output: int = 0) -> list:
    return [str(node), output]


def is_link(value) -> bool:
    return isinstance(value, list) and len(value) == 2 and isinstance(value[0], str)


def binding(node: str | int, field: str, class_type: str) -> dict:
    return {"node": str(node), "field": field, "class_type": class_type}


def direction_id(direction: str, offset: int) -> str:
    return str((DIRECTIONS.index(direction) + 1) * 1000 + offset)


def take_id(direction: str, take: int, offset: int) -> str:
    return direction_id(direction, take * 100 + offset)


def view_graph() -> dict:
    graph = load(FEATURES / "angles/workflows/angle-view.v1.json")
    graph["2"]["inputs"]["filename_prefix"] = "sprite_view"
    return graph


def view_inputs() -> dict:
    inputs = load(FEATURES / "angles/workflows/angle-view.v1.inputs.json")["inputs"]
    return {"workflow": VIEW_WORKFLOW, "inputs": inputs}


def shared_nodes(animate: dict) -> dict:
    """The Wan 2.2 loaders, prompts and samplers' models of `animate-image.v1`, the matting model
    and the grey background every direction is composited onto."""
    graph = {node: copy.deepcopy(animate[node]) for node in (CLIP, VAE, PROMPT, NEGATIVE)}
    graph[PROMPT]["inputs"]["text"] = WALK_PROMPT
    graph[PROMPT]["_meta"] = {"title": "Walk prompt"}
    graph[PROMPT_BACK] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": WALK_PROMPT_BACK, "clip": link(CLIP)},
        "_meta": {"title": "Walk prompt, back view"},
    }
    for node in (UNET_HIGH, LORA_HIGH, MODEL_HIGH, UNET_LOW, LORA_LOW, MODEL_LOW):
        graph[node] = copy.deepcopy(animate[node])
    graph[MATTE_MODEL] = {
        "class_type": "LoadBackgroundRemovalModel",
        "inputs": {"bg_removal_name": "birefnet.safetensors"},
    }
    # The view on flat grey at the clip's size, so Wan animates the character, not a background.
    graph[BACKGROUND] = {
        "class_type": "EmptyImage",
        "inputs": {
            "width": WALK_WIDTH,
            "height": WALK_HEIGHT,
            "batch_size": 1,
            "color": BACKGROUND_GREY,
        },
    }
    return graph


def direction_nodes(animate: dict, direction: str) -> dict:
    graph: dict = {}
    view = direction_id(direction, VIEW)
    scaled = direction_id(direction, SCALED)
    composite = direction_id(direction, COMPOSITE)
    graph[view] = {
        "class_type": "LoadImage",
        "inputs": {"image": "view.png"},
        "_meta": {"title": f"View {direction}"},
    }
    graph[scaled] = {
        "class_type": "ImageScale",
        "inputs": {
            "image": link(view),
            "upscale_method": "lanczos",
            "width": WALK_WIDTH,
            "height": WALK_HEIGHT,
            "crop": "center",
        },
    }
    graph[direction_id(direction, VIEW_MATTE)] = {
        "class_type": "RemoveBackground",
        "inputs": {"bg_removal_model": link(MATTE_MODEL), "image": link(scaled)},
    }
    graph[composite] = {
        "class_type": "ImageCompositeMasked",
        "inputs": {
            "destination": link(BACKGROUND),
            "source": link(scaled),
            "x": 0,
            "y": 0,
            "resize_source": False,
            "mask": link(direction_id(direction, VIEW_MATTE)),
        },
    }

    prompt = PROMPT_BACK if direction == "n" else PROMPT
    for take in TAKES:
        conditioning = take_id(direction, take, CONDITIONING)
        high = take_id(direction, take, SAMPLER_HIGH)
        low = take_id(direction, take, SAMPLER_LOW)
        decode = take_id(direction, take, DECODE)
        # A closed loop: the view is both the first and the last frame, so Wan walks in place
        # and comes back to the start pose.
        graph[conditioning] = {
            "class_type": "WanFirstLastFrameToVideo",
            "inputs": {
                "positive": link(prompt),
                "negative": link(NEGATIVE),
                "vae": link(VAE),
                "width": WALK_WIDTH,
                "height": WALK_HEIGHT,
                "length": WALK_FRAMES,
                "batch_size": 1,
                "start_image": link(composite),
                "end_image": link(composite),
            },
        }
        graph[high] = copy.deepcopy(animate["13"])
        graph[high]["inputs"].update(
            positive=link(conditioning, 0),
            negative=link(conditioning, 1),
            latent_image=link(conditioning, 2),
        )
        graph[high]["_meta"] = {"title": f"High-noise sampler, {direction} take {take}"}
        graph[low] = copy.deepcopy(animate["14"])
        graph[low]["inputs"].update(
            positive=link(conditioning, 0),
            negative=link(conditioning, 1),
            latent_image=link(high),
        )
        graph[low]["_meta"] = {"title": f"Low-noise sampler, {direction} take {take}"}
        graph[decode] = {
            "class_type": "VAEDecode",
            "inputs": {"samples": link(low), "vae": link(VAE)},
        }
        graph[take_id(direction, take, FRAMES_MATTE)] = {
            "class_type": "RemoveBackground",
            "inputs": {"bg_removal_model": link(MATTE_MODEL), "image": link(decode)},
        }

    loop_cut = {
        "frames": link(take_id(direction, 1, DECODE)),
        "mask": link(take_id(direction, 1, FRAMES_MATTE)),
        "min_frames": 10,
        "max_frames": 32,
        "frame_count": 8,
    }
    for take, (frames, mask) in LOOP_CUT_TAKE_INPUTS.items():
        loop_cut[frames] = link(take_id(direction, take, DECODE))
        loop_cut[mask] = link(take_id(direction, take, FRAMES_MATTE))
    graph[direction_id(direction, LOOP_CUT)] = {"class_type": "SpriteLoopCut", "inputs": loop_cut}
    graph[direction_id(direction, PIVOT_LOCK)] = {
        "class_type": "SpritePivotLock",
        "inputs": {
            "frames": link(direction_id(direction, LOOP_CUT), 0),
            "mask": link(direction_id(direction, LOOP_CUT), 1),
            "cell_width": 128,
            "cell_height": 160,
            "fill": 0.92,
            "alpha_threshold": 0.5,
        },
    }
    return graph


def row_id(row: str) -> str:
    return str(901 + SHEET_ROWS.index(row))


def row_nodes() -> dict:
    graph: dict = {}
    previous = None
    for row in SHEET_ROWS:
        source = ROW_SOURCES.get(row, row)
        pivot = direction_id(source, PIVOT_LOCK)
        loop_cut = direction_id(source, LOOP_CUT)
        inputs = {
            "frames": link(pivot, 0),
            "mask": link(pivot, 1),
            "pivot_x": link(pivot, 2),
            "pivot_y": link(pivot, 3),
            "name": f"walk_{row}",
            "flip_horizontal": False,
        }
        if previous is not None:
            inputs["rows"] = link(previous)
        inputs["seam_ratio"] = link(loop_cut, 4)
        inputs["take"] = link(loop_cut, 5)
        graph[row_id(row)] = {"class_type": "SpriteRow", "inputs": inputs}
        previous = row_id(row)
    return graph


def atlas_nodes() -> dict:
    last_row = row_id(SHEET_ROWS[-1])
    return {
        HD_PACK: {
            "class_type": "SpriteAtlasPack",
            "inputs": {"rows": link(last_row), "fps": 10, "image_name": "hd.png"},
        },
        HD_IMAGE: {
            "class_type": "SaveImage",
            "inputs": {"images": link(HD_PACK, 0), "filename_prefix": "sprite_hd"},
        },
        HD_JSON: {
            "class_type": "SaveText",
            "inputs": {"text": link(HD_PACK, 1), "filename_prefix": "sprite_hd", "format": "txt"},
        },
        PIXEL_RESCALE: {
            "class_type": "SpriteRescale",
            "inputs": {"rows": link(last_row), "cell_width": 48, "cell_height": 60},
        },
        PIXEL_PALETTE: {
            "class_type": "SpritePalette",
            "inputs": {
                "rows": link(PIXEL_RESCALE),
                "colors": 24,
                "outline": True,
                "alpha_threshold": 0.5,
            },
        },
        PIXEL_PACK: {
            "class_type": "SpriteAtlasPack",
            "inputs": {"rows": link(PIXEL_PALETTE), "fps": 10, "image_name": "pixel.png"},
        },
        PIXEL_IMAGE: {
            "class_type": "SaveImage",
            "inputs": {"images": link(PIXEL_PACK, 0), "filename_prefix": "sprite_pixel"},
        },
        PIXEL_JSON: {
            "class_type": "SaveText",
            "inputs": {
                "text": link(PIXEL_PACK, 1),
                "filename_prefix": "sprite_pixel",
                "format": "txt",
            },
        },
    }


def sheet_graph() -> dict:
    animate = load(FEATURES / "animateImage/workflows/animate-image.v1.json")
    graph = shared_nodes(animate)
    for direction in DIRECTIONS:
        graph.update(direction_nodes(animate, direction))
    graph.update(row_nodes())
    graph.update(atlas_nodes())
    return graph


def sheet_inputs() -> dict:
    inputs: dict = {}
    for direction in DIRECTIONS:
        inputs[f"view_{direction}"] = binding(direction_id(direction, VIEW), "image", "LoadImage")
    for take in TAKES:
        inputs[f"seed_{take}"] = [
            binding(take_id(direction, take, SAMPLER_HIGH), "noise_seed", "KSamplerAdvanced")
            for direction in DIRECTIONS
        ]
    for row in FLIPPABLE_ROWS:
        inputs[f"flip_{row}"] = binding(row_id(row), "flip_horizontal", "SpriteRow")
    return {"workflow": SHEET_WORKFLOW, "inputs": inputs}


def take_of(node: str) -> tuple[int, int] | None:
    """(direction 1..5, take 1..3) of a take node; None for shared and take-independent ones."""
    number = int(node)
    take = (number % 1000) // 100
    return (number // 1000, take) if number >= 1000 and take else None


def check_links(graph: dict, name: str) -> None:
    for node, spec in graph.items():
        for field, value in spec["inputs"].items():
            if is_link(value):
                assert value[0] in graph, f"{name}: {node}.{field} links to missing node {value[0]}"


def check_inputs_map(graph: dict, inputs_map: dict, workflow: str) -> None:
    assert inputs_map["workflow"] == workflow, f"inputs map names {inputs_map['workflow']}"
    for key, entry in inputs_map["inputs"].items():
        for target in entry if isinstance(entry, list) else [entry]:
            spec = graph.get(target["node"])
            assert spec, f"{workflow}: {key} binds missing node {target['node']}"
            assert spec["class_type"] == target["class_type"], f"{workflow}: {key} class mismatch"
            assert target["field"] in spec["inputs"], f"{workflow}: {key} binds a missing field"
            assert not is_link(spec["inputs"][target["field"]]), f"{workflow}: {key} binds a link"


def check_sheet(graph: dict) -> None:
    check_links(graph, SHEET_WORKFLOW)

    for node, spec in graph.items():
        number = int(node)
        assert node == str(number), f"node id {node!r} is not a plain number"
        if number < 1000:
            assert 1 <= number <= 999, f"shared node id {node} out of range"
        else:
            assert 1 <= number // 1000 <= len(DIRECTIONS), f"node {node}: no such direction"
            assert (number % 1000) // 100 <= len(TAKES), f"node {node}: no such take"
            assert 1 <= number % 100 <= 99, f"node {node}: offset 0 is reserved"

        class_type = spec["class_type"]
        assert class_type in REQUIRED_INPUTS, f"node {node}: unexpected class {class_type}"
        required = REQUIRED_INPUTS[class_type]
        allowed = set(required) | set(OPTIONAL_INPUTS.get(class_type, []))
        missing = [field for field in required if field not in spec["inputs"]]
        unknown = [field for field in spec["inputs"] if field not in allowed]
        assert not missing, f"node {node} ({class_type}) misses {missing}"
        assert not unknown, f"node {node} ({class_type}) has unknown inputs {unknown}"

    # The ids the server binds or reads.
    for direction in DIRECTIONS:
        assert graph[direction_id(direction, VIEW)]["class_type"] == "LoadImage"
    for node, class_type in {
        HD_IMAGE: "SaveImage",
        HD_JSON: "SaveText",
        PIXEL_IMAGE: "SaveImage",
        PIXEL_JSON: "SaveText",
    }.items():
        assert graph[node]["class_type"] == class_type, f"node {node} is not {class_type}"
    for row in SHEET_ROWS:
        spec = graph[row_id(row)]
        assert spec["class_type"] == "SpriteRow" and spec["inputs"]["name"] == f"walk_{row}"

    # A take-2/3 node feeds only its own take of its direction, or that direction's loop cut
    # through the take's own inputs, so pruning takes 2 and 3 leaves no dangling link.
    for node, spec in graph.items():
        for field, value in spec["inputs"].items():
            if not is_link(value) or take_of(value[0]) is None:
                continue
            direction, take = take_of(value[0])
            if take == 1:
                continue
            loop_cut = str(direction * 1000 + LOOP_CUT)
            assert take_of(node) == (direction, take) or (
                node == loop_cut and field in LOOP_CUT_TAKE_INPUTS[take]
            ), f"{node}.{field} reads take node {value[0]}"

    pruned = {
        node: copy.deepcopy(spec)
        for node, spec in graph.items()
        if take_of(node) is None or take_of(node)[1] == 1
    }
    for spec in pruned.values():
        if spec["class_type"] == "SpriteLoopCut":
            for take in (2, 3):
                for field in LOOP_CUT_TAKE_INPUTS[take]:
                    del spec["inputs"][field]
    check_links(pruned, f"{SHEET_WORKFLOW} with one take")


def write(name: str, document: dict) -> None:
    path = HERE / name
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(FEATURES.parent.parent)}")


if __name__ == "__main__":
    view = view_graph()
    view_map = view_inputs()
    check_links(view, VIEW_WORKFLOW)
    check_inputs_map(view, view_map, VIEW_WORKFLOW)

    sheet = sheet_graph()
    sheet_map = sheet_inputs()
    check_sheet(sheet)
    check_inputs_map(sheet, sheet_map, SHEET_WORKFLOW)

    write(VIEW_WORKFLOW, view)
    write("sprite-view.v1.inputs.json", view_map)
    write(SHEET_WORKFLOW, sheet)
    write("sprite-sheet.v1.inputs.json", sheet_map)
