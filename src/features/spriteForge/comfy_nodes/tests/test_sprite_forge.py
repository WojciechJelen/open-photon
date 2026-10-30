"""Sprite Forge's math on synthetic clips; needs torch, numpy and Pillow (ComfyUI's own deps).

    python -m unittest discover -s src/features/spriteForge/comfy_nodes/tests
"""

import json
import math
import sys
import unittest
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sprite_forge import sprite_math  # noqa: E402
from sprite_forge.atlas import SpriteRow, add_row, flipped, pack  # noqa: E402


def figure(height=96, width=64, x=32.0, ground=90, body=60, leg_phase=0.0):
    """One frame: a 12px-wide body standing on `ground`, centred on `x`, legs swinging."""
    mask = torch.zeros(height, width)
    top = ground - body
    left = round(x) - 6
    mask[top : ground - 20, left : left + 12] = 1  # head, chest and hips
    swing = round(6 * math.sin(leg_phase))
    mask[ground - 20 : ground, left + 1 + swing : left + 5 + swing] = 1  # near leg
    mask[ground - 20 : ground, left + 7 - swing : left + 11 - swing] = 1  # far leg
    image = torch.stack([mask * 0.8, mask * 0.3, mask * (0.5 + 0.4 * math.sin(leg_phase))], -1)
    return image, mask


def clip(phases, **kwargs):
    frames, masks = zip(*(figure(leg_phase=p, **kwargs) for p in phases))
    return torch.stack(frames), torch.stack(masks)


class LoopTest(unittest.TestCase):
    def test_finds_one_cycle_after_a_still_lead_in(self):
        period = 12
        phases = [0.0] * 6 + [2 * math.pi * k / period for k in range(36)]
        frames, mask = clip(phases)
        loop = sprite_math.find_loop(frames, mask, min_frames=6, max_frames=30)
        self.assertEqual(loop.length, period)
        self.assertGreaterEqual(loop.start, 6)
        self.assertLess(loop.closure, 1e-6)
        self.assertGreater(loop.motion, 0)

    def test_a_still_lead_in_longer_than_a_loop_is_not_a_loop(self):
        period, still = 12, 16
        phases = [0.0] * still + [2 * math.pi * (k % period) / period for k in range(36)]
        frames, mask = clip(phases)
        loop = sprite_math.find_loop(frames, mask, min_frames=10, max_frames=30)
        self.assertEqual(loop.length, period)
        self.assertGreaterEqual(loop.start, still)
        self.assertGreater(loop.motion, 0)

    def test_refuses_a_clip_that_does_not_move(self):
        frames, mask = clip([0.0] * 36)
        with self.assertRaisesRegex(ValueError, "does not move"):
            sprite_math.find_loop(frames, mask, min_frames=10, max_frames=30)

    def test_samples_evenly_and_keeps_short_loops_whole(self):
        loop = sprite_math.Loop(start=5, length=12, closure=0.0, motion=1.0)
        self.assertEqual(sprite_math.sample_loop(loop, 4), [5, 8, 11, 14])
        self.assertEqual(sprite_math.sample_loop(loop, 0), list(range(5, 17)))
        self.assertEqual(sprite_math.sample_loop(loop, 20), list(range(5, 17)))

    def test_refuses_a_clip_shorter_than_the_shortest_loop(self):
        frames, mask = clip([0.0] * 10)
        with self.assertRaisesRegex(ValueError, "needs 11 frames"):
            sprite_math.find_loop(frames, mask, min_frames=8, max_frames=16)


class TakeTest(unittest.TestCase):
    PHASES = [2 * math.pi * k / 12 for k in range(36)]

    def noisy(self, seed):
        """A take whose frames never repeat exactly, so every loop it has shows a seam."""
        frames, mask = clip(self.PHASES)
        noise = torch.rand(frames.shape, generator=torch.Generator().manual_seed(seed))
        return frames + noise * 0.2 * mask[..., None], mask

    def test_keeps_the_take_with_the_lowest_seam_ratio(self):
        take, loops = sprite_math.best_take(
            [self.noisy(1), clip(self.PHASES), self.noisy(2)], min_frames=6, max_frames=30
        )
        self.assertEqual(take, 2)
        self.assertEqual(sorted(loops), [1, 2, 3])
        ratios = {number: sprite_math.seam_ratio(loop) for number, loop in loops.items()}
        self.assertLess(ratios[2], min(ratios[1], ratios[3]))

    def test_a_missing_take_keeps_its_number(self):
        take, loops = sprite_math.best_take(
            [self.noisy(1), (None, None), clip(self.PHASES)], min_frames=6, max_frames=30
        )
        self.assertEqual(take, 3)
        self.assertEqual(sorted(loops), [1, 3])

    def test_a_take_needs_frames_and_a_mask(self):
        frames, mask = clip(self.PHASES)
        with self.assertRaisesRegex(ValueError, "take 2 needs both frames and a mask"):
            sprite_math.best_take([(frames, mask), (frames, None)], 6, 30)
        with self.assertRaisesRegex(ValueError, "take 3 needs both frames and a mask"):
            sprite_math.best_take([(frames, mask), (None, None), (None, mask)], 6, 30)

    def test_a_take_that_does_not_move_loses_to_one_that_does(self):
        take, loops = sprite_math.best_take(
            [clip([0.0] * 36), clip(self.PHASES)], min_frames=6, max_frames=30
        )
        self.assertEqual(take, 2)
        self.assertIsNone(loops[1])

    def test_refuses_takes_that_all_stand_still(self):
        still = clip([0.0] * 36)
        with self.assertRaisesRegex(ValueError, "no take moves"):
            sprite_math.best_take([still, (None, None), still], min_frames=6, max_frames=30)


class PivotTest(unittest.TestCase):
    def test_drifting_frames_share_ground_and_centre(self):
        drift = [(20.0, 70), (26.0, 80), (40.0, 90), (33.5, 75)]
        frames, mask = map(
            torch.stack,
            zip(*(figure(x=x, ground=g, leg_phase=i) for i, (x, g) in enumerate(drift))),
        )
        image, alpha, pivot_x, pivot_y = sprite_math.pivot_lock(
            frames, mask, cell_width=40, cell_height=50, fill=0.9
        )
        self.assertEqual(tuple(image.shape), (4, 50, 40, 3))
        self.assertEqual((pivot_x, pivot_y), (20, 48))
        for placement in sprite_math.place(alpha, 0.5):
            self.assertEqual(placement.ground, pivot_y)
            self.assertAlmostEqual(placement.anchor_x, pivot_x, delta=0.75)
            self.assertGreaterEqual(placement.top, 1)

    def test_empty_frame_is_refused(self):
        frames, mask = clip([0.0, 1.0])
        mask[1] = 0
        with self.assertRaisesRegex(ValueError, "frame 1 has no character"):
            sprite_math.pivot_lock(frames, mask, 40, 50, 0.9)

    def test_rescale_moves_the_pivot_with_the_cells(self):
        frames, mask = clip([0.0, 1.0])
        image, alpha, pivot_x, pivot_y = sprite_math.pivot_lock(frames, mask, 64, 80, 0.9)
        small, small_alpha, pivot = sprite_math.rescale(image, alpha, (pivot_x, pivot_y), 32, 40)
        self.assertEqual(tuple(small.shape), (2, 40, 32, 3))
        self.assertEqual(pivot, (16, 38))
        for placement in sprite_math.place(small_alpha, 0.5):
            self.assertEqual(placement.ground, pivot[1])


class PaletteTest(unittest.TestCase):
    def test_colours_come_from_one_palette_and_alpha_is_binary(self):
        frames, mask = clip([0.0, 1.0, 2.0])
        noise = torch.rand(frames.shape, generator=torch.Generator().manual_seed(1))
        frames = frames + noise * 0.05 * mask[..., None]
        palette = sprite_math.build_palette([(frames, mask)], colors=4)
        image, alpha = sprite_math.apply_palette(frames, mask, palette, outline=False)
        self.assertLessEqual(len(palette), 4)
        self.assertTrue(set(alpha.unique().tolist()) <= {0.0, 1.0})
        opaque = image[alpha > 0]
        in_palette = (opaque[:, None, :] == palette[None]).all(-1).any(1)
        self.assertTrue(bool(in_palette.all()))
        again = sprite_math.build_palette([(frames, mask)], colors=4)
        self.assertTrue(torch.equal(palette, again))

    def test_outline_only_touches_the_character(self):
        frames, mask = clip([0.0])
        palette = sprite_math.build_palette([(frames, mask)], colors=3)
        _, alpha = sprite_math.apply_palette(frames, mask, palette, outline=True)
        edge = (alpha > 0) & ~(mask > 0.5)
        self.assertGreater(int(edge.sum()), 0)
        grown = torch.nn.functional.max_pool2d(mask[:, None], 3, stride=1, padding=1)[:, 0] > 0
        self.assertFalse(bool((edge & ~grown).any()))

    def walk(self):
        """Enough opaque pixels (40 frames of ~640) that the palette samples them."""
        frames, mask = clip([2 * math.pi * k / 12 for k in range(40)])
        self.assertGreater(int((mask > 0.5).sum()), sprite_math.PALETTE_SAMPLES)
        return frames, mask

    def test_the_palette_is_on_the_frames_device(self):
        frames, mask = self.walk()
        palette = sprite_math.build_palette([(frames, mask)], colors=6)
        self.assertEqual(palette.device, frames.device)

    @unittest.skipUnless(torch.cuda.is_available(), "needs CUDA")
    def test_a_gpu_palette_matches_the_cpu_one(self):
        frames, mask = self.walk()
        palette = sprite_math.build_palette([(frames, mask)], colors=6)
        gpu = sprite_math.build_palette([(frames.cuda(), mask.cuda())], colors=6)
        self.assertEqual(gpu.device.type, "cuda")
        self.assertTrue(torch.equal(gpu.cpu(), palette))
        image, alpha = sprite_math.apply_palette(frames.cuda(), mask.cuda(), gpu, outline=True)
        self.assertEqual(image.device.type, "cuda")
        self.assertEqual(alpha.device.type, "cuda")


class AtlasTest(unittest.TestCase):
    def row(self, name, count, width=8, height=10, loop=None):
        frames = torch.rand(count, height, width, 3)
        mask = (torch.rand(count, height, width) > 0.5).float()
        return SpriteRow(name, frames, mask, (width // 2, height - 1), loop=loop)

    def test_grid_tags_and_pivots(self):
        rows = add_row((), self.row("walk_s", 3, loop=(2, 0.31249)))
        rows = add_row(rows, self.row("walk_w", 2, loop=(1, 0.5)))
        rows = add_row(rows, flipped(rows[1], "walk_e"))
        rows = add_row(rows, self.row("walk_n", 1))
        image, text = pack(rows, fps=10, image_name="hd.png")
        self.assertEqual(tuple(image.shape), (1, 4 * 10, 3 * 8, 4))
        self.assertEqual(image.dtype, torch.float32)
        data = json.loads(text)
        self.assertEqual(text, json.dumps(data, separators=(",", ":")))
        self.assertEqual(len(data["frames"]), 8)
        self.assertEqual(
            [(t["name"], t["from"], t["to"]) for t in data["meta"]["frameTags"]],
            [("walk_s", 0, 2), ("walk_w", 3, 4), ("walk_e", 5, 6), ("walk_n", 7, 7)],
        )
        self.assertEqual(data["frames"][4]["frame"], {"x": 8, "y": 10, "w": 8, "h": 10})
        self.assertEqual(data["frames"][0]["duration"], 100)
        self.assertEqual(data["meta"]["image"], "hd.png")
        self.assertEqual(data["meta"]["size"], {"w": 24, "h": 40})
        keys = data["meta"]["slices"][0]["keys"]
        self.assertEqual([k["frame"] for k in keys], [0, 3, 5, 7])
        # The mirrored row keeps its source's loop; a row given none is left out.
        self.assertEqual(
            data["meta"]["loops"],
            [
                {"tag": "walk_s", "take": 2, "seam_ratio": 0.312},
                {"tag": "walk_w", "take": 1, "seam_ratio": 0.5},
                {"tag": "walk_e", "take": 1, "seam_ratio": 0.5},
            ],
        )
        # Alpha is the row's mask, and the mirrored row's cell is the source cell flipped left
        # to right.
        atlas = image[0]
        self.assertTrue(torch.equal(atlas[0:10, 0:8, 3], rows[0].mask[0]))
        self.assertTrue(torch.equal(atlas[20:30, 0:8], atlas[10:20, 0:8].flip(1)))

    def test_loops_are_omitted_when_no_row_has_them(self):
        _, text = pack(add_row((), self.row("walk_s", 2)), fps=10, image_name="atlas.png")
        self.assertNotIn("loops", json.loads(text)["meta"])

    def test_a_full_sheet_fits_a_text_output(self):
        names = ["walk_s", "walk_sw", "walk_w", "walk_nw", "walk_n", "walk_ne", "walk_e", "walk_se"]
        palette = tuple(f"#{k:02x}{k:02x}{k:02x}" for k in range(24))
        rows = ()
        for take, name in enumerate(names):
            row = SpriteRow(
                name,
                torch.zeros(8, 160, 128, 3),
                torch.zeros(8, 160, 128),
                (64, 150),
                palette,
                (take % 3 + 1, 0.123456),
            )
            rows = add_row(rows, row)
        image, text = pack(rows, fps=10, image_name="hd.png")
        self.assertEqual(tuple(image.shape), (1, 8 * 160, 8 * 128, 4))
        self.assertEqual(len(json.loads(text)["meta"]["loops"]), 8)
        # The app's TEXT_OUTPUT_MAX_BYTES.
        self.assertLess(len(text.encode()), 16384)

    def test_rows_must_share_a_cell_size_and_names_must_be_unique(self):
        rows = add_row((), self.row("walk_s", 2))
        with self.assertRaisesRegex(ValueError, "cells"):
            add_row(rows, self.row("walk_n", 2, width=9))
        with self.assertRaisesRegex(ValueError, "already"):
            add_row(rows, self.row("walk_s", 2))


if __name__ == "__main__":
    unittest.main()
