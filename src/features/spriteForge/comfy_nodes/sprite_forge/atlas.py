"""Sprite rows and their atlas: one RGBA grid plus Aseprite's JSON (array) description of it.

Aseprite's JSON is what Phaser (`load.aseprite`), Godot and Unity importers already read: one
`frames` entry per cell in order, a `frameTags` entry per animation (here, per direction) and a
`pivot` slice whose key at each tag's first frame holds that tag's pivot.
"""

import json
from dataclasses import dataclass, replace

import numpy as np
import torch

APP = "Open Photon Sprite Forge"
VERSION = "0.1"


@dataclass(frozen=True)
class SpriteRow:
    """One animation of one direction: cells of one size, and the pivot they share."""

    name: str
    frames: torch.Tensor
    mask: torch.Tensor
    pivot: tuple[int, int]
    palette: tuple[str, ...] = ()
    # `(take, seam_ratio)` of the SpriteLoopCut take the cells were cut from, when the row was
    # given them; the atlas JSON reports it so a player can see how clean each loop is.
    loop: tuple[int, float] | None = None

    @property
    def cell(self) -> tuple[int, int]:
        """`(width, height)`."""
        return self.mask.shape[2], self.mask.shape[1]


def add_row(rows: tuple[SpriteRow, ...], row: SpriteRow) -> tuple[SpriteRow, ...]:
    if any(existing.name == row.name for existing in rows):
        raise ValueError(f"a row named {row.name!r} is already in the sheet")
    if rows and rows[0].cell != row.cell:
        raise ValueError(f"row {row.name!r} has {row.cell} cells, the sheet {rows[0].cell}")
    if row.frames.shape[0] != row.mask.shape[0] or row.frames.shape[0] == 0:
        raise ValueError(f"row {row.name!r} needs as many masks as frames, and at least one")
    return rows + (row,)


def flipped(row: SpriteRow, name: str) -> SpriteRow:
    width, _ = row.cell
    return replace(
        row,
        name=name,
        frames=torch.flip(row.frames, dims=[2]),
        mask=torch.flip(row.mask, dims=[2]),
        pivot=(width - row.pivot[0], row.pivot[1]),
    )


def _rgba(row: SpriteRow, index: int) -> np.ndarray:
    rgba = torch.cat([row.frames[index, ..., :3], row.mask[index, ..., None]], dim=-1)
    return (rgba.clamp(0, 1) * 255).round().to(torch.uint8).cpu().numpy()


def pack(rows: tuple[SpriteRow, ...], fps: float, image_name: str) -> tuple[torch.Tensor, str]:
    """The atlas as a `[1, H, W, 4]` RGBA IMAGE, and its Aseprite JSON.

    One row per direction, one column per frame. The JSON is compact (no indentation, no spaces
    after separators) so a full sheet stays under the app's limit for a text output.
    """
    if not rows:
        raise ValueError("the sheet has no rows")
    width, height = rows[0].cell
    columns = max(row.frames.shape[0] for row in rows)
    atlas = np.zeros((len(rows) * height, columns * width, 4), dtype=np.uint8)
    duration = round(1000 / fps)
    frames, tags, keys = [], [], []
    for r, row in enumerate(rows):
        first = len(frames)
        for c in range(row.frames.shape[0]):
            x, y = c * width, r * height
            atlas[y : y + height, x : x + width] = _rgba(row, c)
            frames.append(
                {
                    "filename": f"{row.name} {c}",
                    "frame": {"x": x, "y": y, "w": width, "h": height},
                    "rotated": False,
                    "trimmed": False,
                    "spriteSourceSize": {"x": 0, "y": 0, "w": width, "h": height},
                    "sourceSize": {"w": width, "h": height},
                    "duration": duration,
                }
            )
        tags.append(
            {"name": row.name, "from": first, "to": len(frames) - 1, "direction": "forward"}
        )
        keys.append(
            {
                "frame": first,
                "bounds": {"x": 0, "y": 0, "w": width, "h": height},
                "pivot": {"x": row.pivot[0], "y": row.pivot[1]},
            }
        )
    meta = {
        "app": APP,
        "version": VERSION,
        "image": image_name,
        "format": "RGBA8888",
        "size": {"w": atlas.shape[1], "h": atlas.shape[0]},
        "scale": "1",
        "frameTags": tags,
        "layers": [{"name": "sprite", "opacity": 255, "blendMode": "normal"}],
        "slices": [{"name": "pivot", "color": "#0000ffff", "keys": keys}],
    }
    if rows[0].palette:
        meta["palette"] = list(rows[0].palette)
    loops = [
        {"tag": row.name, "take": row.loop[0], "seam_ratio": round(row.loop[1], 3)}
        for row in rows
        if row.loop is not None
    ]
    if loops:
        meta["loops"] = loops
    image = torch.from_numpy(atlas).float().div(255)[None]
    return image, json.dumps({"frames": frames, "meta": meta}, separators=(",", ":"))
