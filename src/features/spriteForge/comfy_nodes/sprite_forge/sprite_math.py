"""Sprite Forge's image math, as plain torch functions over ComfyUI's tensors.

IMAGE: `[frames, height, width, 3]` floats in 0..1. MASK: `[frames, height, width]` floats in
0..1 where 1 is the character: `RemoveBackground`'s convention, the inverse of `LoadImage`'s.

A pivot is a point on pixel edges (not centres) in cell coordinates: `(cell_width // 2,
ground)`, where `ground` is the edge under the lowest row of the character.
"""

import math
from dataclasses import dataclass

import torch
import torch.nn.functional as F

# Loop search compares frames at this size (long side), which keeps it cheap for any clip.
FEATURE_SIDE = 64
# A loop within this factor of the best score that is shorter wins: one cycle, not two.
SHORTER_LOOP_TOLERANCE = 1.1
# The seam compares this many frames on each side of the cut as well, so it matches motion and
# not only pose: a walk's half cycle (legs crossing) shows the pose of a full one, moving the
# other way.
SEAM_RADIUS = 1
# A loop candidate counts as moving only if its mean step is at least this share of the clip's
# pace: the `MOTION_PERCENTILE` quantile of its consecutive-frame differences, which is the
# pace of its walking frames rather than of the standing ones Wan clips start and end with.
# Without it a still stretch (closure and motion both 0) scores 0 and beats every real loop.
# Being relative to the clip it holds at any size and colour depth (HD or pixel art). On real
# walk clips standing frames step ~0.1-0.5e-2 and walking ones ~2-3e-2, so a quarter of the
# walking pace sits between the two, well below the motion of any loop that walks.
MOVING_SHARE = 0.25
MOTION_PERCENTILE = 0.9
# A mean frame difference below this is float noise: the frames are the same.
STILL = 1e-6
# The horizontal anchor is the centroid of this top share of the body (head and chest), which
# swinging arms and legs barely move.
ANCHOR_BAND = 0.45
PALETTE_SAMPLES = 20_000
PALETTE_ITERATIONS = 16


@dataclass(frozen=True)
class Loop:
    start: int
    length: int
    # Mean absolute difference between the frames around the start and the frames around the
    # frame after the last one (`SEAM_RADIUS`): how visible the seam is when the loop wraps.
    closure: float
    # Mean absolute difference between consecutive frames inside the loop: how much it moves.
    motion: float


def _features(frames: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """`[frames, d]`: colour over the character plus coverage, at `FEATURE_SIDE`."""
    x = torch.cat([frames[..., :3] * mask[..., None], mask[..., None]], dim=-1)
    x = x.permute(0, 3, 1, 2).float()
    height, width = x.shape[-2:]
    scale = FEATURE_SIDE / max(height, width)
    size = (max(1, round(height * scale)), max(1, round(width * scale)))
    return F.interpolate(x, size=size, mode="area").flatten(1)


def _distances(
    frames: torch.Tensor, mask: torch.Tensor, min_frames: int, max_frames: int
) -> torch.Tensor:
    """`[frames, frames]`: mean absolute feature difference between every pair of frames."""
    count = frames.shape[0]
    if min_frames < 2 or max_frames < min_frames:
        raise ValueError(f"loop bounds must satisfy 2 <= min <= max, got {min_frames}..{max_frames}")
    needed = min_frames + 1 + 2 * SEAM_RADIUS
    if count < needed:
        raise ValueError(f"a loop of at least {min_frames} frames needs {needed} frames, got {count}")
    features = _features(frames, mask)
    return torch.cdist(features, features, p=1) / features.shape[1]


def _pace(distance: torch.Tensor) -> float:
    """How fast a clip moves when it moves: the `MOTION_PERCENTILE` quantile of its steps."""
    return float(torch.quantile(distance.diagonal(1), MOTION_PERCENTILE))


def _best_loop(
    distance: torch.Tensor, min_frames: int, max_frames: int, pace: float
) -> Loop | None:
    """`find_loop` over `_distances`, counting only loops that move against `pace`; None if none."""
    count = distance.shape[0]
    steps = distance.diagonal(1)
    cumulative = torch.cat([steps.new_zeros(1), steps.cumsum(0)])
    floor = max(MOVING_SHARE * pace, STILL)

    best_per_length: list[tuple[float, Loop]] = []
    for length in range(min_frames, min(max_frames, count - 1 - 2 * SEAM_RADIUS) + 1):
        starts = torch.arange(SEAM_RADIUS, count - length - SEAM_RADIUS)
        closure = torch.stack(
            [
                distance[starts + offset, starts + length + offset]
                for offset in range(-SEAM_RADIUS, SEAM_RADIUS + 1)
            ]
        ).mean(0)
        motion = (cumulative[starts + length] - cumulative[starts]) / length
        moving = motion >= floor
        if not bool(moving.any()):
            continue
        score = torch.where(moving, closure / motion.clamp_min(STILL), math.inf)
        index = int(score.argmin())
        loop = Loop(int(starts[index]), length, float(closure[index]), float(motion[index]))
        best_per_length.append((float(score[index]), loop))

    if not best_per_length:
        return None
    best_score = min(score for score, _ in best_per_length)
    return next(
        loop
        for score, loop in best_per_length
        if score <= best_score * SHORTER_LOOP_TOLERANCE
    )


def find_loop(
    frames: torch.Tensor, mask: torch.Tensor, min_frames: int, max_frames: int
) -> Loop:
    """The frames `start .. start + length - 1` that loop best.

    A loop is scored by its seam relative to its motion (`closure / motion`), and only loops
    that move at least `MOVING_SHARE` of the clip's pace count, so a clip cannot win by standing
    still. Among loops within `SHORTER_LOOP_TOLERANCE` of the best score the shortest wins, so
    two cycles never take the frames one cycle needs.
    """
    distance = _distances(frames, mask, min_frames, max_frames)
    loop = _best_loop(distance, min_frames, max_frames, _pace(distance))
    if loop is None:
        raise ValueError(
            f"the clip does not move: no loop of {min_frames}..{max_frames} frames does; "
            "generate it again with another seed"
        )
    return loop


def sample_loop(loop: Loop, frame_count: int) -> list[int]:
    """`frame_count` evenly spaced frame indices of `loop` (all of them for 0 or more)."""
    if frame_count <= 0 or frame_count >= loop.length:
        return list(range(loop.start, loop.start + loop.length))
    return [loop.start + (k * loop.length) // frame_count for k in range(frame_count)]


def seam_ratio(loop: Loop) -> float:
    """`find_loop`'s score: the seam's visibility per unit of motion; lower loops more cleanly."""
    return loop.closure / max(loop.motion, STILL)


def best_take(
    takes: list[tuple[torch.Tensor | None, torch.Tensor | None]], min_frames: int, max_frames: int
) -> tuple[int, dict[int, Loop | None]]:
    """The take (1-based) whose best loop has the lowest seam ratio, and each given take's loop.

    Takes are clips of one view generated with different seeds; a take that was not generated is
    `(None, None)` and keeps its number free, so the numbers always match the seeds. Ties go to
    the earlier take. Every take's loops must move against the fastest take's pace, as
    `find_loop`'s must against the clip's own; a take with no such loop maps to None and loses.
    """
    given: dict[int, tuple[torch.Tensor, torch.Tensor]] = {}
    for number, (frames, mask) in enumerate(takes, start=1):
        if (frames is None) != (mask is None):
            raise ValueError(f"take {number} needs both frames and a mask")
        if frames is not None:
            given[number] = (frames, mask)
    if not given:
        raise ValueError("no take was given")
    distances = {
        number: _distances(frames, mask, min_frames, max_frames)
        for number, (frames, mask) in given.items()
    }
    pace = max(_pace(distance) for distance in distances.values())
    loops = {
        number: _best_loop(distance, min_frames, max_frames, pace)
        for number, distance in distances.items()
    }
    moving = {number: loop for number, loop in loops.items() if loop is not None}
    if not moving:
        raise ValueError(
            f"no take moves: none has a moving loop of {min_frames}..{max_frames} frames; "
            "generate the takes again with other seeds"
        )
    return min(moving, key=lambda number: seam_ratio(moving[number])), loops


def _premultiplied(frames: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """`[frames, 4, h, w]`: RGB times alpha, then alpha; what resampling must work on."""
    return torch.cat([frames[..., :3] * mask[..., None], mask[..., None]], dim=-1).permute(
        0, 3, 1, 2
    )


def _straight(x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """Back to IMAGE and MASK from `_premultiplied` layout."""
    x = x.clamp(0, 1)
    alpha = x[:, 3]
    rgb = torch.where(alpha[:, None] > 1e-4, x[:, :3] / alpha[:, None].clamp_min(1e-4), 0)
    return rgb.clamp(0, 1).permute(0, 2, 3, 1).contiguous(), alpha.contiguous()


def _resize(x: torch.Tensor, height: int, width: int) -> torch.Tensor:
    if (height, width) == tuple(x.shape[-2:]):
        return x
    return F.interpolate(x, size=(height, width), mode="bilinear", antialias=True, align_corners=False)


def _paste(source: torch.Tensor, height: int, width: int, x: int, y: int) -> torch.Tensor:
    """`source` (`[c, h, w]`) placed at `(x, y)` on a transparent `[c, height, width]` cell."""
    out = source.new_zeros(source.shape[0], height, width)
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(width, x + source.shape[2]), min(height, y + source.shape[1])
    if x1 > x0 and y1 > y0:
        out[:, y0:y1, x0:x1] = source[:, y0 - y : y1 - y, x0 - x : x1 - x]
    return out


@dataclass(frozen=True)
class Placement:
    """Where one frame's character is in its source image."""

    top: int
    ground: int  # edge under the lowest character row
    anchor_x: float  # head-and-chest centroid, in edge coordinates
    half_width: float  # farthest character pixel edge from the anchor


def place(mask: torch.Tensor, threshold: float) -> list[Placement]:
    placements = []
    for index, frame in enumerate(mask > threshold):
        rows = frame.any(1).nonzero().flatten()
        columns = frame.any(0).nonzero().flatten()
        if rows.numel() == 0:
            raise ValueError(f"frame {index} has no character above alpha {threshold}")
        top, bottom = int(rows[0]), int(rows[-1])
        band = frame[top : top + max(1, round(ANCHOR_BAND * (bottom - top + 1)))]
        anchor_x = float(band.nonzero()[:, 1].float().mean()) + 0.5
        half_width = max(anchor_x - int(columns[0]), int(columns[-1]) + 1 - anchor_x)
        placements.append(Placement(top, bottom + 1, anchor_x, half_width))
    return placements


def pivot_lock(
    frames: torch.Tensor,
    mask: torch.Tensor,
    cell_width: int,
    cell_height: int,
    fill: float,
    threshold: float = 0.5,
) -> tuple[torch.Tensor, torch.Tensor, int, int]:
    """Every frame on a `cell_width` x `cell_height` cell, feet on one ground line.

    Each frame is aligned on its own: its lowest character row sits on the cell's ground line
    and its head-and-chest centroid on the cell's centre column, which removes the drift and
    jitter of a generated clip while keeping the stride and the bob. One scale for all frames
    fits the tallest and widest frame into `fill` of the cell.
    """
    placements = place(mask, threshold)
    margin = max(1, round(cell_height * (1 - fill) / 2))
    tallest = max(p.ground - p.top for p in placements)
    widest = max(p.half_width for p in placements)
    scale = min((cell_height - 2 * margin) / tallest, (cell_width / 2 - margin) / widest)

    source_height, source_width = mask.shape[1:]
    height = max(1, round(source_height * scale))
    width = max(1, round(source_width * scale))
    scaled = _resize(_premultiplied(frames, mask).float(), height, width)
    scale_y, scale_x = height / source_height, width / source_width

    pivot_x, pivot_y = cell_width // 2, cell_height - margin
    cells = [
        _paste(
            scaled[index],
            cell_height,
            cell_width,
            round(pivot_x - p.anchor_x * scale_x),
            round(pivot_y - p.ground * scale_y),
        )
        for index, p in enumerate(placements)
    ]
    image, alpha = _straight(torch.stack(cells))
    return image, alpha, pivot_x, pivot_y


def rescale(
    frames: torch.Tensor,
    mask: torch.Tensor,
    pivot: tuple[int, int],
    cell_width: int,
    cell_height: int,
) -> tuple[torch.Tensor, torch.Tensor, tuple[int, int]]:
    """Cells resized to fit a new cell size, the pivot moved with them (centre column, bottom)."""
    source_height, source_width = mask.shape[1:]
    scale = min(cell_width / source_width, cell_height / source_height)
    height = max(1, round(source_height * scale))
    width = max(1, round(source_width * scale))
    scaled = _resize(_premultiplied(frames, mask).float(), height, width)
    x = cell_width // 2 - round(pivot[0] * width / source_width)
    y = cell_height - height
    cells = torch.stack([_paste(cell, cell_height, cell_width, x, y) for cell in scaled])
    image, alpha = _straight(cells)
    return image, alpha, (cell_width // 2, y + round(pivot[1] * height / source_height))


def _kmeans(pixels: torch.Tensor, colors: int, generator: torch.Generator) -> torch.Tensor:
    """`colors` centres for `pixels` (`[n, 3]`): k-means++ seeding, then Lloyd iterations."""
    centres = pixels[torch.randint(len(pixels), (1,), generator=generator)]
    while len(centres) < colors:
        nearest = torch.cdist(pixels, centres).min(1).values.square()
        if float(nearest.sum()) == 0:
            break
        centres = torch.cat([centres, pixels[torch.multinomial(nearest, 1, generator=generator)]])
    for _ in range(PALETTE_ITERATIONS):
        assignment = torch.cdist(pixels, centres).argmin(1)
        for k in range(len(centres)):
            members = pixels[assignment == k]
            if len(members):
                centres[k] = members.mean(0)
    return centres


def build_palette(
    rows: list[tuple[torch.Tensor, torch.Tensor]], colors: int, threshold: float = 0.5
) -> torch.Tensor:
    """One palette (`[k, 3]`, k <= `colors`) for the opaque pixels of every row, deterministic.

    The palette is fitted on the CPU, where the seeded generator lives (sampling on a GPU with it
    fails, and would not match the CPU's draws anyway), and returned on the rows' device.
    """
    pixels = torch.cat([frames[mask > threshold] for frames, mask in rows]).float()
    if len(pixels) == 0:
        raise ValueError(f"no pixel is above alpha {threshold}; nothing to build a palette from")
    device = pixels.device
    generator = torch.Generator().manual_seed(0)
    if len(pixels) > PALETTE_SAMPLES:
        sample = torch.randperm(len(pixels), generator=generator)[:PALETTE_SAMPLES]
        pixels = pixels[sample.to(device)]
    return _kmeans(pixels.cpu(), colors, generator).to(device)


def apply_palette(
    frames: torch.Tensor,
    mask: torch.Tensor,
    palette: torch.Tensor,
    outline: bool,
    threshold: float = 0.5,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Every opaque pixel snapped to its nearest palette colour; alpha made 0 or 1.

    `outline` adds a one-pixel edge, in the palette's darkest colour at half brightness, on
    every transparent pixel that touches the character side to side or top to bottom.
    """
    opaque = mask > threshold
    flat = frames[..., :3].reshape(-1, 3).float()
    snapped = palette[torch.cdist(flat, palette).argmin(1)].reshape(frames.shape[:-1] + (3,))
    image = torch.where(opaque[..., None], snapped, 0)
    if outline:
        padded = F.pad(opaque.float()[:, None], (1, 1, 1, 1))[:, 0]
        touching = (
            padded[:, :-2, 1:-1] + padded[:, 2:, 1:-1] + padded[:, 1:-1, :-2] + padded[:, 1:-1, 2:]
        ) > 0
        edge = touching & ~opaque
        darkest = palette[(palette @ palette.new_tensor([0.299, 0.587, 0.114])).argmin()] * 0.5
        image = torch.where(edge[..., None], darkest, image)
        opaque = opaque | edge
    return image, opaque.float()


def to_hex(colour: torch.Tensor) -> str:
    r, g, b = (round(float(c) * 255) for c in colour.clamp(0, 1))
    return f"#{r:02x}{g:02x}{b:02x}"
