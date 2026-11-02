"""The calm-face pick, without ComfyUI (numpy and OpenCV):
  docker cp comfy_nodes/xolotl comfyui:/tmp/xolotl-test && docker exec comfyui python3.13 /tmp/xolotl-test/test_expressions.py"""
import importlib.util
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location("expressions", Path(__file__).with_name("expressions.py"))
expressions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(expressions)


def face(mouth_width, nose_shift=0.0, tilt=0.0):
    """YuNet's layout: box, right eye, left eye, nose, right and left mouth corners, score; eyes 40 px apart."""
    return np.array([80, 60, 80, 100, 100, 100, 140, 100 + tilt, 120 + nose_shift, 125,
                     120 - mouth_width / 2, 150, 120 + mouth_width / 2, 150, 0.9], np.float32)


assert abs(expressions.calm_ratio(face(34)) - 0.85) < 1e-6, "mouth width over eye distance"
assert expressions.calm_ratio(face(34, nose_shift=8)) is None, "a face turned away is not measured"
assert expressions.calm_ratio(face(34, tilt=10)) is None, "nor a tilted head"


class Detector:
    """Stands in for YuNet: one face per frame, the mouth width the frame's value."""
    def __init__(self, widths):
        self.widths, self.calls = widths, 0

    def setInputSize(self, size):
        pass

    def detect(self, image):
        width = self.widths[self.calls]
        self.calls += 1
        return 1, None if width is None else face(width)[None] / np.array([2] * 14 + [1], np.float32)


frames = np.zeros((6, 8, 8, 3), np.float32)
# a pout, a smile, no face, two calm faces and a wider smile: the frontal ratios' median is the 34 px mouth's
assert expressions.neutral_index(frames, Detector([26, 40, None, 33, 34, 44]), every=1) == 4
assert expressions.neutral_index(frames, Detector([None] * 6), every=1) == 0, "no face anywhere: the first frame"
print("expressions: ok")
