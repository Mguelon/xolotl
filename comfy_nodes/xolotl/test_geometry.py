"""python3 comfy_nodes/xolotl/test_geometry.py — the canvas math, without ComfyUI."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("geometry", Path(__file__).with_name("geometry.py"))
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)
fit = geometry.fit_canvas

# A 16:9-ish clip the pack would have cropped 3.4 %: it now fits exactly, nothing padded or lost.
assert fit(1344, 768, "480") == {"canvas": [896, 512], "box": [0, 0, 896, 512]}
# 1080p keeps the whole frame; the 18 leftover columns are padded, split evenly.
assert fit(1920, 1080, "480") == {"canvas": [928, 512], "box": [8, 0, 910, 512]}
assert fit(1080, 1920, "480") == {"canvas": [512, 928], "box": [0, 8, 512, 910]}
# A clip already on the grid and within the budget comes back as it is.
assert fit(928, 512, "480") == {"canvas": [928, 512], "box": [0, 0, 928, 512]}

for width, height in [(1344, 768), (1920, 1080), (1080, 1920), (1440, 1080), (640, 360), (2560, 1080), (720, 720),
                      (3840, 2160), (854, 480), (1280, 544)]:
    for resolution, budget in geometry.PIXEL_BUDGETS.items():
        f = fit(width, height, resolution)
        (cw, ch), (x, y, w, h) = f["canvas"], f["box"]
        assert cw % 32 == 0 and ch % 32 == 0 and cw * ch <= budget, f
        assert 0 <= x and 0 <= y and x + w <= cw and y + h <= ch, f
        assert x % 2 == 0 and y % 2 == 0 and w % 2 == 0 and h % 2 == 0, f
        assert abs((w / h) / (width / height) - 1) < 0.005, (width, height, f)
        assert w * h >= 0.9 * cw * ch, ("too much padding", width, height, resolution, f)

for bad in [(0, 768, "480"), (1344, -1, "480"), (1344, 768, "1080")]:
    try:
        fit(*bad)
    except ValueError:
        pass
    else:
        raise AssertionError(f"accepted {bad}")
print("geometry: ok")
