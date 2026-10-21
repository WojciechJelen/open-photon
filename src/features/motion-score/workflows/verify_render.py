"""Verify actual rendered MP4s using ffmpeg/ffprobe and the Python standard library."""

import json
from pathlib import Path
import subprocess

from build_poc import FRAMES, ROOT, SOURCE_PINS, TARGET_PINS


def inspect(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries',
        'stream=codec_type,width,height,r_frame_rate,nb_frames,duration', '-of', 'json', str(path),
    ]))['streams']


def frames(path):
    raw = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-vf', 'scale=32:56',
        '-pix_fmt', 'gray', '-f', 'rawvideo', '-',
    ])
    size = 32*56
    assert len(raw) % size == 0
    return [raw[i:i+size] for i in range(0, len(raw), size)]


def verify(directory):
    source = frames(ROOT / 'samples/driver-16fps.mp4')
    output = frames(directory / 'retimed-driver.mp4')
    assert len(source) == len(output) == FRAMES
    streams = {}
    for name in ['retimed-driver', 'before-after', 'character', 'driver-character']:
        info = inspect(directory / f'{name}.mp4')
        video = next(s for s in info if s['codec_type'] == 'video')
        audio = next(s for s in info if s['codec_type'] == 'audio')
        assert video['r_frame_rate'] == '16/1'
        assert int(video['nb_frames']) == FRAMES
        assert abs(float(audio['duration'])-float(video['duration'])) < 1/16
        streams[name] = info

    pins = []
    for source_index, target_index in zip(SOURCE_PINS, TARGET_PINS):
        distances = [sum(abs(a-b) for a, b in zip(output[target_index], frame))/len(frame) for frame in source]
        observed = min(range(len(source)), key=distances.__getitem__)
        assert observed == source_index, (source_index, target_index, observed)
        pins.append({'source_frame': source_index, 'target_frame': target_index,
                     'nearest_source_frame_in_render': observed, 'error_frames': 0})
    return {'streams': streams, 'driver_pins': pins,
            'method': 'Nearest source frame by grayscale MAE at 32x56, after decoding the Cloud MP4.',
            'generated_gesture_timing': 'unmeasured; exact driver pins do not certify generated gestures'}


if __name__ == '__main__':
    import sys
    result = verify(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'samples/results')
    print(json.dumps(result, indent=2))
