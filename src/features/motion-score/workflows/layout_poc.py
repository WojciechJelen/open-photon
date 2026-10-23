"""Arrange a ComfyUI-exported visual graph without changing executable nodes."""

import json
from pathlib import Path
import sys

path = Path(sys.argv[1])
workflow = json.loads(path.read_text())
positions = {
    1: (0, 830, 320, 560), 2: (0, 1440, 300, 160), 3: (350, 1440, 280, 140),
    4: (0, 1660, 630, 180), 5: (350, 830, 320, 560),
    30: (1440, 100, 420, 300), 31: (1440, 450, 300, 140),
    32: (1900, 100, 420, 300), 33: (1900, 450, 420, 170),
    34: (1900, 680, 420, 100), 35: (1440, 680, 420, 180),
    36: (1440, 930, 880, 220), 37: (720, 650, 640, 240), 38: (720, 950, 640, 200),
    40: (2400, 100, 420, 220), 41: (2400, 400, 420, 600),
    42: (2860, 100, 420, 220), 43: (2860, 400, 420, 220), 44: (2860, 700, 420, 460),
    50: (720, 1370, 290, 180),
    60: (3390, 1350, 420, 220), 61: (3390, 1650, 420, 670),
    62: (3850, 1350, 600, 220), 63: (3850, 1650, 600, 220), 64: (3850, 1950, 600, 520),
    73: (3390, 600, 300, 200), 77: (3750, 600, 700, 210),
    78: (3390, 870, 300, 120), 79: (3750, 870, 300, 140), 80: (4100, 870, 350, 270),
}
for i in range(3):
    positions[10+i] = (720, 100+i*165, 300, 110)
    positions[20+i] = (1060, 100+i*165, 300, 110)
    positions[70+i] = (3390+i*360, 100, 330, 130)
    positions[74+i] = (3390+i*360, 330, 330, 200)

models = [578, 579, 580, 583, 584, 581, 582, 585, 589, 598, 594, 591, 592, 593, 587, 597, 602, 601]
for i, key in enumerate(models):
    positions[key] = (720+(i % 6)*430, 1640+(i // 6)*300, 390, 240)

for node in workflow['nodes']:
    if node['id'] not in positions:
        continue
    x, y, width, height = positions[node['id']]
    node['pos'] = [x, y]
    node['size'] = [width, height]
    if node['id'] in models:
        node['flags']['collapsed'] = node['id'] not in [587, 597, 591, 582, 585]
    if node['id'] in [587, 597]:
        node['size'][1] = 520
    if node['id'] == 597:
        node['widgets_values'][1:3] = [218734, 'fixed']
        node['widgets_values_named'].update(noise_seed=218734, control_after_generate='fixed')

note = {
    'id': 900, 'type': 'MarkdownNote', 'pos': [0, 70], 'size': [640, 630],
    'flags': {}, 'order': 100, 'mode': 0, 'inputs': [], 'outputs': [],
    'title': 'Motion Score · START HERE', 'properties': {},
    'widgets_values': ['''# Motion Score — runnable PoC

**Pin a performance to a soundtrack, then animate a character.**

1. Edit SOURCE and TARGET frame numbers (16 frames = 1 second).
2. Run. The driver is retimed inside this graph before Wan Animate 2.
3. Compare original / retimed and driver / character videos.
4. Inspect the generated events; enter observed frame numbers in OBSERVED.
   Leave -1 when the event is missing or uncertain. Unknown is not a pass.

## Demo score
Source 28 → target 32 (2 s); 52 → 48 (3 s); 64 → 64 (4 s).
These are manually selected poses, not automatically recognized actions.
The soundtrack is a synthesized 120 BPM click track with stronger accents.

## PoC limits
81 frames at 16 fps (5.0625 s). Source assets are already normalized.
Ordered interior pins; local speed 0.75–1.5x. Invalid pins stop at VALIDATE
with a division-by-zero error. Output fps and sample duration stay fixed.
Nearest-frame retiming can repeat/drop frames. No optical interpolation.
Wan may alter or omit gestures: the retimed driver's exact pins do not
prove that the generated character followed them. Audit is manual.

Use the separate Motion Score preview workflow for fast retiming-only runs.
Full setup, provenance and measured results: src/features/motion-score/README.md.
'''],
}
workflow['nodes'] = [n for n in workflow['nodes'] if n['id'] != 900] + [note]
workflow['last_node_id'] = max(n['id'] for n in workflow['nodes'])
groups = [
    ('01 · Inputs and guide', [-40, 0, 740, 1880], '#344b60'),
    ('02 · Pin the score · frames at 16 fps', [690, 0, 700, 1200], '#3e6d58'),
    ('03 · Validate and retime RGB', [1400, 0, 960, 1200], '#3e6d58'),
    ('04 · Inspect the timing edit', [2360, 0, 960, 1200], '#6b5938'),
    ('05 · Wan Animate 2 · one fragment', [690, 1250, 2630, 1430], '#514168'),
    ('06 · Human-confirmed timing audit', [3350, 0, 1140, 1200], '#655040'),
    ('07 · Generated outputs', [3350, 1250, 1140, 1430], '#344b60'),
]
workflow['groups'] = [{'id': i+1, 'title': title, 'bounding': box, 'color': color,
                       'font_size': 24, 'flags': {}} for i, (title, box, color) in enumerate(groups)]
workflow['extra']['ds'] = {'scale': 0.4, 'offset': [100, 100]}
path.write_text(json.dumps(workflow, indent=2)+'\n')
print('Arranged', len(workflow['nodes']), 'nodes in', len(groups), 'groups')
