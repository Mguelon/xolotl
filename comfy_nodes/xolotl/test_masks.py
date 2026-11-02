"""Checks masks.py against scipy's distance transform, the pack's way. Needs numpy, OpenCV and scipy: inside the
ComfyUI container,
  docker cp comfy_nodes/xolotl comfyui:/tmp/xolotl-test && docker exec comfyui python3.13 /tmp/xolotl-test/test_masks.py
"""
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt

sys.path.insert(0, str(Path(__file__).parent))
from masks import grow  # noqa: E402


def reference(binary, radius):
    return np.stack([(distance_transform_edt(~m) <= radius) if radius and m.any() else m for m in binary])


rng = np.random.default_rng(7)
h, w = 96, 160
yy, xx = np.mgrid[0:h, 0:w]
cases = {
    "ellipse": ((xx - 70) / 20) ** 2 + ((yy - 50) / 35) ** 2 <= 1,
    "specks": rng.random((h, w)) < 0.002,
    "edge": (xx < 3) | (yy > h - 2),
    "one pixel": (xx == 80) & (yy == 40),
    "empty": np.zeros((h, w), bool),
    "full": np.ones((h, w), bool),
}
stack = np.stack(list(cases.values()) * 3)
for radius in (0, 1, 5, 17, 64, 200):
    got, want = grow(stack, radius), reference(stack, radius)
    assert got.dtype == bool and got.shape == stack.shape
    for i, name in enumerate(list(cases) * 3):
        assert np.array_equal(got[i], want[i]), f"radius {radius}, {name}: {int((got[i] != want[i]).sum())} pixels differ"
print("masks: ok")
