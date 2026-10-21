"""Run: python3 -m unittest discover -s src/features/motion-score/workflows -p 'test_*.py'."""

import unittest

from build_poc import FRAMES, MAP, SOURCE_PINS, TARGET_PINS, build, frame_map, prune


class MotionScoreTests(unittest.TestCase):
    def test_identity_is_exact(self):
        self.assertEqual(frame_map(SOURCE_PINS, SOURCE_PINS), list(range(FRAMES)))

    def test_pins_endpoints_and_monotonicity(self):
        mapping = frame_map(SOURCE_PINS, TARGET_PINS)
        self.assertEqual((mapping[0], mapping[-1], len(mapping)), (0, 80, 81))
        self.assertEqual(mapping, sorted(mapping))
        for source, target in zip(SOURCE_PINS, TARGET_PINS):
            self.assertEqual(mapping[target], source)

    def test_invalid_pins_and_source_length_stop(self):
        for source, target, count in [
            ([0, 52, 64], TARGET_PINS, 81),
            ([28, 28, 64], TARGET_PINS, 81),
            (SOURCE_PINS, [32, 32, 64], 81),
            (SOURCE_PINS, [32, 64, 48], 81),
            (SOURCE_PINS, [16, 48, 64], 81),
            (SOURCE_PINS, TARGET_PINS, 80),
        ]:
            with self.subTest(source=source, target=target, count=count):
                with self.assertRaises(ValueError):
                    frame_map(source, target, count)

    def test_changed_pin_changes_rgb_selection(self):
        changed = frame_map(SOURCE_PINS, [31, 48, 64])
        self.assertNotEqual(changed, frame_map(SOURCE_PINS, TARGET_PINS))
        self.assertEqual(changed[31], 28)

    def test_graph_connects_retimed_rgb_and_target_audio(self):
        graph = build()
        self.assertEqual(graph['32']['inputs']['expression'], MAP)
        self.assertEqual(graph['587']['inputs']['pose_video'], ['35', 0])
        for output in ['40', '43', '60', '63']:
            self.assertEqual(graph[output]['inputs']['fps'], 16)
            self.assertEqual(graph[output]['inputs']['audio'], ['4', 0])
        for node in graph.values():
            for value in node['inputs'].values():
                if isinstance(value, list):
                    self.assertIn(value[0], graph)
        self.assertNotIn('587', prune(graph, ['41', '44']))

    def test_audit_unknown_never_becomes_measured(self):
        graph = build()
        self.assertEqual(graph['77']['inputs']['values.a'], ['74', 0])
        self.assertEqual(eval(graph['74']['inputs']['expression'], {"__builtins__": {}}, {'a': 33, 'b': 32}), 62.5)
        expression = graph['73']['inputs']['expression']
        for values in [[-1, -1, -1], [32, -1, 64], [32, 80, 64]]:
            self.assertFalse(eval(expression, {"__builtins__": {}}, dict(zip('abc', values))))
        self.assertTrue(eval(expression, {"__builtins__": {}}, dict(zip('abc', [32, 48, 64]))))
        self.assertIn('UNMEASURED', graph['78']['inputs']['value'])


if __name__ == '__main__':
    unittest.main()
