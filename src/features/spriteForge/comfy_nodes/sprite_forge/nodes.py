"""Sprite Forge's ComfyUI nodes: walk clips in, an engine-ready sprite atlas out.

    takes (frames + mask) -> SpriteLoopCut -> SpritePivotLock -> SpriteRow (one per direction,
    chained) -> [SpriteRescale -> SpritePalette] -> SpriteAtlasPack -> SaveImage + SaveText

MASK inputs follow `RemoveBackground`: 1 is the character.
"""

import os
from dataclasses import replace

import folder_paths
import numpy as np
import torch
from comfy_api.latest import ComfyExtension, io, ui
from PIL import Image
from typing_extensions import override

from . import sprite_math
from .atlas import SpriteRow, add_row, flipped, pack

SpriteRows = io.Custom("SPRITE_ROWS")
CATEGORY = "sprite forge"


class SpriteFramesLoad(io.ComfyNode):
    """Every PNG of one folder under ComfyUI's input directory, in name order."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SpriteFramesLoad",
            display_name="Sprite Frames Load",
            category=CATEGORY,
            description=(
                "Loads every PNG in a folder of the input directory, in name order, as frames "
                "and their alpha (1 = opaque), e.g. the RGBA frames a matted clip was saved as."
            ),
            inputs=[io.String.Input("directory", default="sprite-forge/frames")],
            outputs=[io.Image.Output(display_name="frames"), io.Mask.Output(display_name="mask")],
        )

    @classmethod
    def _files(cls, directory: str) -> list[str]:
        root = os.path.realpath(folder_paths.get_input_directory())
        folder = os.path.realpath(os.path.join(root, directory))
        if os.path.commonpath([root, folder]) != root or not os.path.isdir(folder):
            raise ValueError(f"{directory!r} is not a folder inside the input directory")
        names = sorted(f for f in os.listdir(folder) if f.lower().endswith(".png"))
        if not names:
            raise ValueError(f"{directory!r} holds no PNG")
        files = []
        for name in names:
            # A link inside the folder may point anywhere: open only what resolves to a regular
            # file under the input directory, and open the resolved path that was checked.
            path = os.path.realpath(os.path.join(folder, name))
            if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
                raise ValueError(
                    f"{os.path.join(directory, name)!r} is not a file inside the input directory"
                )
            files.append(path)
        return files

    @classmethod
    def fingerprint_inputs(cls, directory):
        return [(path, os.path.getmtime(path), os.path.getsize(path)) for path in cls._files(directory)]

    @classmethod
    def execute(cls, directory) -> io.NodeOutput:
        rgba = []
        for path in cls._files(directory):
            with Image.open(path) as image:
                rgba.append(np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0)
        if len({frame.shape for frame in rgba}) != 1:
            raise ValueError(f"the PNGs in {directory!r} differ in size")
        frames = torch.from_numpy(np.stack(rgba))
        return io.NodeOutput(frames[..., :3].contiguous(), frames[..., 3].contiguous())


class SpriteLoopCut(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SpriteLoopCut",
            display_name="Sprite Loop Cut",
            category=CATEGORY,
            description=(
                "Finds the stretch of a clip that loops with the least visible seam for its "
                "motion, preferring one cycle over two, and samples evenly spaced frames from it. "
                "Given more takes of the same view, keeps the one that loops most cleanly."
            ),
            inputs=[
                io.Image.Input("frames"),
                io.Mask.Input("mask", tooltip="1 = character, as RemoveBackground outputs"),
                io.Int.Input("min_frames", default=10, min=2, max=1024),
                io.Int.Input("max_frames", default=32, min=2, max=1024),
                io.Int.Input(
                    "frame_count",
                    default=8,
                    min=0,
                    max=1024,
                    tooltip="Frames to keep from the loop; 0 keeps every frame",
                ),
                io.Image.Input("frames_2", optional=True, tooltip="A second take of the view"),
                io.Mask.Input("mask_2", optional=True),
                io.Image.Input("frames_3", optional=True, tooltip="A third take of the view"),
                io.Mask.Input("mask_3", optional=True),
            ],
            outputs=[
                io.Image.Output(display_name="frames"),
                io.Mask.Output(display_name="mask"),
                io.Int.Output(display_name="loop_start"),
                io.Int.Output(display_name="loop_length"),
                io.Float.Output(display_name="seam_ratio"),
                io.Int.Output(display_name="take", tooltip="The take kept, 1-based"),
            ],
        )

    @classmethod
    def execute(
        cls,
        frames,
        mask,
        min_frames,
        max_frames,
        frame_count,
        frames_2=None,
        mask_2=None,
        frames_3=None,
        mask_3=None,
    ) -> io.NodeOutput:
        takes = [(frames, mask), (frames_2, mask_2), (frames_3, mask_3)]
        take, loops = sprite_math.best_take(takes, min_frames, max_frames)
        loop = loops[take]
        clip, alpha = takes[take - 1]
        indices = sprite_math.sample_loop(loop, frame_count)
        ratio = sprite_math.seam_ratio(loop)
        ratios = ", ".join(
            f"take {number} {sprite_math.seam_ratio(candidate):.3f}"
            if candidate is not None
            else f"take {number} does not move"
            for number, candidate in loops.items()
        )
        return io.NodeOutput(
            clip[indices],
            alpha[indices],
            loop.start,
            loop.length,
            ratio,
            take,
            ui=ui.PreviewText(
                f"kept take {take}: loop {loop.start}..{loop.start + loop.length - 1} "
                f"({loop.length} frames), kept {len(indices)}; seam/motion {ratios}"
            ),
        )


class SpritePivotLock(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SpritePivotLock",
            display_name="Sprite Pivot Lock",
            category=CATEGORY,
            description=(
                "Puts every frame on a fixed-size cell with the feet on one ground line and the "
                "head and chest on the centre column, at one scale for all frames."
            ),
            inputs=[
                io.Image.Input("frames"),
                io.Mask.Input("mask"),
                io.Int.Input("cell_width", default=128, min=8, max=4096),
                io.Int.Input("cell_height", default=160, min=8, max=4096),
                io.Float.Input("fill", default=0.92, min=0.1, max=1.0, step=0.01),
                io.Float.Input("alpha_threshold", default=0.5, min=0.01, max=0.99, step=0.01),
            ],
            outputs=[
                io.Image.Output(display_name="frames"),
                io.Mask.Output(display_name="mask"),
                io.Int.Output(display_name="pivot_x"),
                io.Int.Output(display_name="pivot_y"),
            ],
        )

    @classmethod
    def execute(cls, frames, mask, cell_width, cell_height, fill, alpha_threshold) -> io.NodeOutput:
        return io.NodeOutput(
            *sprite_math.pivot_lock(frames, mask, cell_width, cell_height, fill, alpha_threshold)
        )


class SpriteRowNode(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SpriteRow",
            display_name="Sprite Row",
            category=CATEGORY,
            description=(
                "Adds one direction's cells to a sheet; with flip_horizontal it adds their mirror "
                "image instead (a west walk from an east one). Chain one per direction. Given "
                "SpriteLoopCut's seam_ratio and take, the atlas JSON reports them for this row."
            ),
            inputs=[
                io.Image.Input("frames"),
                io.Mask.Input("mask"),
                io.Int.Input("pivot_x", default=64, min=0, max=4096),
                io.Int.Input("pivot_y", default=150, min=0, max=4096),
                io.String.Input("name", default="walk_s"),
                io.Boolean.Input("flip_horizontal", default=False),
                SpriteRows.Input("rows", optional=True),
                # Sockets without widgets: a widget would always send its default, and the atlas
                # would report a loop quality nobody measured.
                io.Float.Input("seam_ratio", optional=True, force_input=True),
                io.Int.Input("take", optional=True, force_input=True),
            ],
            outputs=[SpriteRows.Output(display_name="rows")],
        )

    @classmethod
    def execute(
        cls,
        frames,
        mask,
        pivot_x,
        pivot_y,
        name,
        flip_horizontal,
        rows=None,
        seam_ratio=None,
        take=None,
    ) -> io.NodeOutput:
        if (seam_ratio is None) != (take is None):
            raise ValueError(f"row {name!r} needs both seam_ratio and take, or neither")
        loop = None if take is None else (take, seam_ratio)
        row = SpriteRow(name, frames, mask, (pivot_x, pivot_y), loop=loop)
        if flip_horizontal:
            row = flipped(row, name)
        return io.NodeOutput(add_row(rows or (), row))


class SpriteRescale(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SpriteRescale",
            display_name="Sprite Rescale",
            category=CATEGORY,
            description="Resizes every row's cells to a new cell size, pivots included.",
            inputs=[
                SpriteRows.Input("rows"),
                io.Int.Input("cell_width", default=48, min=4, max=4096),
                io.Int.Input("cell_height", default=60, min=4, max=4096),
            ],
            outputs=[SpriteRows.Output(display_name="rows")],
        )

    @classmethod
    def execute(cls, rows, cell_width, cell_height) -> io.NodeOutput:
        out = ()
        for row in rows:
            frames, mask, pivot = sprite_math.rescale(
                row.frames, row.mask, row.pivot, cell_width, cell_height
            )
            out = add_row(out, replace(row, frames=frames, mask=mask, pivot=pivot))
        return io.NodeOutput(out)


class SpritePalette(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SpritePalette",
            display_name="Sprite Palette",
            category=CATEGORY,
            description=(
                "Pixel-art finish: one palette for every frame of every row, hard 0/1 alpha and "
                "an optional one-pixel outline."
            ),
            inputs=[
                SpriteRows.Input("rows"),
                io.Int.Input("colors", default=24, min=2, max=256),
                io.Boolean.Input("outline", default=True),
                io.Float.Input("alpha_threshold", default=0.5, min=0.01, max=0.99, step=0.01),
            ],
            outputs=[SpriteRows.Output(display_name="rows")],
        )

    @classmethod
    def execute(cls, rows, colors, outline, alpha_threshold) -> io.NodeOutput:
        palette = sprite_math.build_palette(
            [(row.frames, row.mask) for row in rows], colors, alpha_threshold
        )
        hexes = tuple(sprite_math.to_hex(colour) for colour in palette)
        out = ()
        for row in rows:
            frames, mask = sprite_math.apply_palette(
                row.frames, row.mask, palette, outline, alpha_threshold
            )
            out = add_row(out, replace(row, frames=frames, mask=mask, palette=hexes))
        return io.NodeOutput(out)


class SpriteAtlasPack(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SpriteAtlasPack",
            display_name="Sprite Atlas Pack",
            category=CATEGORY,
            description=(
                "Packs the sheet into an RGBA atlas (one row per direction) and its Aseprite JSON "
                "(frames, a tag per row, pivots, the palette and each row's loop quality when "
                "known). Save them with SaveImage and SaveText."
            ),
            inputs=[
                SpriteRows.Input("rows"),
                io.Float.Input("fps", default=10.0, min=1.0, max=60.0, step=0.5),
                io.String.Input(
                    "image_name",
                    default="atlas.png",
                    tooltip="The JSON's meta.image: the file name the atlas will be shipped as",
                ),
            ],
            outputs=[io.Image.Output(display_name="atlas"), io.String.Output(display_name="json")],
        )

    @classmethod
    def execute(cls, rows, fps, image_name) -> io.NodeOutput:
        return io.NodeOutput(*pack(rows, fps, image_name))


class SpriteForgeExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            SpriteFramesLoad,
            SpriteLoopCut,
            SpritePivotLock,
            SpriteRowNode,
            SpriteRescale,
            SpritePalette,
            SpriteAtlasPack,
        ]
