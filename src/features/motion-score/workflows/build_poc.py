"""Build the Cloud-compatible Motion Score graph; no custom node installation."""

import json
import math
from pathlib import Path
import struct
import wave

ROOT = Path(__file__).resolve().parents[1]
FPS = 16
FRAMES = 81
SOURCE_PINS = [28, 52, 64]
TARGET_PINS = [32, 48, 64]
VALIDATE = (
    "81 if (g == 81 and 0 < a < b < c < 80 and 0 < d < e < f < 80 "
    "and 0.75 <= a/d <= 1.5 and 0.75 <= (b-a)/(e-d) <= 1.5 "
    "and 0.75 <= (c-b)/(f-e) <= 1.5 and 0.75 <= (80-c)/(80-f) <= 1.5) else 1/0"
)
MAP = (
    "round(a*b/e if a <= e else "
    "b+(a-e)*(c-b)/(f-e) if a <= f else "
    "c+(a-f)*(d-c)/(g-f) if a <= g else d+(a-g)*(80-d)/(80-g))"
)


def frame_map(source, target, count=FRAMES):
    """Reference evaluator for the exact expression sent to ComfyUI."""
    variables = dict(zip("abcdefg", [*source, *target, count]))
    try:
        eval(VALIDATE, {"__builtins__": {}}, variables)
    except ZeroDivisionError as error:
        raise ValueError("Need 81 frames, ordered interior pins, and 0.75–1.5x speeds") from error
    return [
        eval(MAP, {"__builtins__": {}, "round": round},
             dict(zip("abcdefg", [index, *source, *target])))
        for index in range(count)
    ]


def build(refs=None):
    refs = refs or {
        "driver": "driver-16fps.mp4", "audio": "score-120bpm.wav",
        "reference": "reference.png",
    }
    graph = {}

    def node(key, kind, title, **inputs):
        graph[str(key)] = {"class_type": kind, "inputs": inputs, "_meta": {"title": title}}
        return [str(key), 0]

    def math_node(key, title, expression, *values):
        node(key, "ComfyMathExpression", title, expression=expression,
             **{f"values.{chr(97+i)}": v for i, v in enumerate(values)})
        return [str(key), 1]

    source = [node(10+i, "PrimitiveInt", f"SOURCE {i+1} — frame at 16 fps", value=v)
              for i, v in enumerate(SOURCE_PINS)]
    target = [node(20+i, "PrimitiveInt", f"TARGET {i+1} — frame at 16 fps", value=v)
              for i, v in enumerate(TARGET_PINS)]
    video = node(1, "LoadVideo", "01 · Source performance · 81 frames / 16 fps", file=refs["driver"])
    images = node(2, "GetVideoComponents", "Decode source RGB frames", video=video)
    size = node(3, "GetImageSize", "Source frame count", image=images)
    audio = node(4, "LoadAudio", "02 · Target soundtrack · 120 BPM / 5.0625 s", audio=refs["audio"])
    ref = node(5, "LoadImage", "03 · Character reference", image=refs["reference"])
    stop = math_node(30, "VALIDATE · ordered pins / 0.75–1.5x / 81 frames", VALIDATE,
                     *source, *target, [size[0], 2])
    indexes = node(31, "Basic data handling: DataListRange", "Output frame clock: 0–80", start=0, stop=stop, step=1)
    mapped = math_node(32, "Motion Score · piecewise-linear source frame", MAP, indexes, *source, *target)
    strings = node(33, "StringFormat", "One source index per output frame", f_string="{a:d}", **{"values.a": mapped})
    joined = node(34, "Basic data handling: StringDataListJoin", "Compile frame map", strings=strings, sep=",")
    driver = node(35, "GetImagesFromBatchIndexed", "04 · Retime RGB driver (nearest frame)", images=images, indexes=joined)
    node(36, "PreviewAny", "Inspect compiled source frame map", source=joined)
    plan = node(37, "StringFormat", "Score plan · source → target frames (16 fps)",
                f_string="Pin 1: {a} → {d}\nPin 2: {b} → {e}\nPin 3: {c} → {f}\n81 frames @ 16 fps; 0.75–1.5x; manual landmarks",
                **{f"values.{chr(97+i)}": v for i, v in enumerate([*source, *target])})
    node(38, "PreviewAny", "Read score plan", source=plan)

    def save(key, title, frames, prefix):
        movie = node(key, "CreateVideo", title, images=frames, fps=FPS, audio=audio)
        node(key+1, "SaveVideo", title+" · MP4", video=movie, filename_prefix=prefix,
             format="mp4", **{"format.codec": "h264", "codec": "h264"})

    save(40, "Preview · retimed driver + target beat", driver, "motion-score/driver")
    comparison = node(42, "ImageConcatMulti", "Left: original · Right: retimed", inputcount=2,
                      image_1=images, image_2=driver, direction="right", match_image_size=True)
    save(43, "A/B · original vs retimed driver", comparison, "motion-score/before-after")

    # The one-fragment generation path follows the checked-in official Wan Animate 2 export.
    base = json.loads((ROOT.parents[0] / "motionTransfer/workflows/motion-transfer.v1.json").read_text())
    keys = [578, 579, 580, 583, 584, 581, 582, 585, 589, 598, 594, 591, 592, 593, 587, 597, 602, 601]
    for key in keys:
        original = base[f"672:{key}"]
        inputs = {k: [str(v[0]).removeprefix("672:"), v[1]] if isinstance(v, list) else v
                  for k, v in original["inputs"].items()}
        node(key, original["class_type"], original.get("_meta", {}).get("title", original["class_type"]), **inputs)
    graph["589"]["inputs"]["image"] = ref
    first = node(50, "ImageFromBatch", "Retimed pose reference frame", image=driver, batch_index=0, length=1)
    graph["598"]["inputs"]["image"] = first
    graph["594"]["inputs"].update(model=["579", 0], device="cpu")
    graph["582"]["inputs"]["text"] = "A pink-haired woman with mechanical arms performs energetic street dance, full body, stable camera."
    graph["587"]["inputs"].update(width=288, height=512, length=FRAMES, video_frame_offset=0,
                                        reference_image=ref, pose_video=driver)
    graph["587"]["inputs"].pop("continue_motion", None)
    graph["597"]["inputs"]["noise_seed"] = 218734
    save(60, "05 · Generated character + target beat", ["601", 0], "motion-score/character")
    generated_compare = node(62, "ImageConcatMulti", "Left: scored driver · Right: generated", inputcount=2,
                             image_1=driver, image_2=["601", 0], direction="right", match_image_size=True)
    save(63, "Compare generated motion with scored driver", generated_compare, "motion-score/driver-character")

    # Audit uses explicit human observations. -1 never produces a measured/pass result.
    observations = [node(70+i, "PrimitiveInt", f"OBSERVED {i+1} · generated frame (-1 = unmeasured)", value=-1) for i in range(3)]
    valid = math_node(73, "All three observations confirmed?", "0 <= a < b < c <= 80", *observations)
    errors = []
    for i, (observation, target_frame) in enumerate(zip(observations, target)):
        error = math_node(74+i, f"Pin {i+1} · error in milliseconds", "(a-b)*1000/16", observation, target_frame)
        errors.append([error[0], 0])
    report = node(77, "StringFormat", "Manual timing audit", f_string="MANUAL OBSERVATIONS\nError ms: {a}, {b}, {c}\nTolerance target: ±125 ms. Inspect appearance separately.",
                  **{f"values.{chr(97+i)}": v for i, v in enumerate(errors)})
    unknown = node(78, "PrimitiveString", "Unknown is not a pass", value="UNMEASURED — inspect generated video; enter three observed event frames in OBSERVED controls. -1 means unknown.")
    status = node(79, "ComfySwitchNode", "Measured audit or explicit unknown", switch=[valid[0], 2], on_false=unknown, on_true=report)
    node(80, "PreviewAny", "06 · Timing audit (human-confirmed)", source=status)
    return graph


def prune(graph, outputs):
    keep = set()

    def visit(key):
        if key in keep:
            return
        keep.add(key)
        for value in graph[key]["inputs"].values():
            if isinstance(value, list):
                visit(value[0])

    for key in outputs:
        visit(key)
    return {key: value for key, value in graph.items() if key in keep}


def soundtrack():
    path = ROOT / "samples/score-120bpm.wav"
    rate = 48000
    samples = bytearray()
    for sample in range(FRAMES * rate // FPS):
        time = sample / rate
        beat = math.floor(time * 2)
        age = time - beat / 2
        accented = beat in [4, 6, 8]
        value = (0.65 if accented else 0.25) * math.sin(2*math.pi*(1100 if accented else 700)*age) * math.exp(-age*70)
        samples.extend(struct.pack("<h", round(value*32767)))
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(samples)


if __name__ == "__main__":
    import sys
    refs = json.loads(Path(sys.argv[1]).read_text()) if len(sys.argv) > 1 else None
    graph = build(refs)
    for filename, data in [("motion-score.api.json", graph),
                           ("motion-score-preview.api.json", prune(graph, ["36", "38", "41", "44"]))]:
        (ROOT / "workflows" / filename).write_text(json.dumps(data, indent=2)+"\n")
    soundtrack()
    print("Built full and preview graphs;", len(frame_map(SOURCE_PINS, TARGET_PINS)), "frames")
