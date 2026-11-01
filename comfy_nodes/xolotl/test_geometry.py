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

box = geometry.person_box
terrace = fit(1344, 768, "480") | {"width": 1344, "height": 768}
# The terrace clip: the swap changed x 46-876, y 18-768 at full size; on the 896x512 canvas that is x 31-584, y 12-512.
b = box([31, 12, 584, 512], terrace)
assert b["x"] % 2 == 0 and b["y"] % 2 == 0 and b["w"] % 2 == 0 and b["h"] % 2 == 0, b
assert b["x"] + b["w"] <= 1344 and b["y"] + b["h"] <= 768 and b["y"] == 0, b
assert b["x"] == 0 and b["x"] + b["w"] >= 876 + 100, ("the person and the margin, stopped by the left edge", b)
assert 9 / 16 - 0.01 <= b["w"] / b["h"] <= 16 / 9 + 0.01, b
# A small standing person in a 1080p frame: the crop is a portrait around them, at least 9:16.
hd = fit(1920, 1080, "480") | {"width": 1920, "height": 1080}
s = 910 / 1920
b = box([8 + 800 * s, 200 * s, 8 + 1000 * s, 900 * s], hd)
assert abs(b["w"] / b["h"] - 9 / 16) < 0.02, b
assert b["x"] < 800 and b["x"] + b["w"] > 1000 and b["y"] < 200 and b["y"] + b["h"] > 900, b
assert fit(b["w"], b["h"], "480")["box"][2] >= b["w"] * 0.9, ("the crop fits the budget at nearly full scale: the 32-px grid costs a little", b)
# A person filling the frame, the whole frame, and a mask that only sat in the padding.
assert box([0, 0, 928, 512], hd) == {"x": 0, "y": 0, "w": 1920, "h": 1080}
assert box(None, hd) == {"x": 0, "y": 0, "w": 1920, "h": 1080}
assert box([0, 0, 8, 512], hd) == {"x": 0, "y": 0, "w": 1920, "h": 1080}
# A person lying across the frame: the crop is widened no further than 16:9 and never leaves the frame.
b = box([100, 300, 800, 340], hd)
assert b["w"] / b["h"] <= 16 / 9 + 0.01 and b["x"] >= 0 and b["x"] + b["w"] <= 1920, b
for bbox in [[0, 0, 1, 1], [900, 500, 928, 512], [100, 100, 101, 400], [-50, -50, 2000, 2000]]:
    b = box(bbox, hd)
    assert 0 <= b["x"] and 0 <= b["y"] and b["x"] + b["w"] <= 1920 and b["y"] + b["h"] <= 1080 and b["w"] >= 2 and b["h"] >= 2, (bbox, b)
    assert b["x"] % 2 == 0 and b["y"] % 2 == 0 and b["w"] % 2 == 0 and b["h"] % 2 == 0, (bbox, b)
print("person box: ok")
