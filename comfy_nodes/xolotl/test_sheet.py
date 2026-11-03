"""The simple sheet's layout, without ComfyUI (numpy and OpenCV):
  docker cp comfy_nodes/xolotl comfyui:/tmp/xolotl-test && docker exec comfyui python3.13 /tmp/xolotl-test/test_sheet.py"""
import importlib.util
from pathlib import Path

import cv2
import numpy as np

spec = importlib.util.spec_from_file_location("sheet", Path(__file__).with_name("sheet.py"))
sheet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sheet)

WHITE = (250, 250, 250)


def figure(width=600, height=1000, top=100, bottom=900, shirt=(200, 40, 40), background=WHITE):
    """A standing figure on a white background: a round head, a neck, a shirt with arms, dark trousers."""
    picture = np.full((height, width, 3), background, np.uint8)
    span = bottom - top
    cx = width // 2
    head = round(0.07 * span)
    cv2.circle(picture, (cx, top + head), head, (120, 80, 60), -1)                          # head: rows top..top+2h
    cv2.rectangle(picture, (cx - 18, top + 2 * head - 4), (cx + 18, top + round(0.18 * span)), (120, 80, 60), -1)  # neck
    cv2.rectangle(picture, (cx - 110, top + round(0.18 * span)), (cx + 110, top + round(0.55 * span)), shirt, -1)
    cv2.rectangle(picture, (cx - 80, top + round(0.55 * span)), (cx + 80, bottom - 1), (40, 40, 60), -1)
    return picture


front = figure()
alpha = sheet.figure_alpha(front)
# The head's topmost row has under 3 solid pixels, which bounds() leaves out as noise.
assert sheet.bounds(alpha) == (101, 900, 190, 411), sheet.bounds(alpha)
assert alpha[500, 300] == 1.0 and alpha[50, 50] == 0.0

# The sheet: the whole front and the whole back on one floor line, the face square as tall as them, on the white.
back = figure()
face = np.full((1024, 1024, 3), WHITE, np.uint8)
cv2.circle(face, (512, 450), 300, (120, 80, 60), -1)
out = sheet.simple_sheet(front, back, face)
assert out.shape[0] == 2 * sheet.MARGIN + sheet.HEIGHT
assert tuple(out[5, 5]) == WHITE and tuple(out[-5, -5]) == WHITE
scale = sheet.HEIGHT / 799
pad = round(sheet.PAD * 799)
figure_w = round((221 + 2 * pad) * scale)
assert out.shape[1] == 2 * sheet.MARGIN + 2 * figure_w + sheet.HEIGHT + 2 * sheet.GAP, out.shape
floor = sheet.MARGIN + sheet.HEIGHT
back_x = sheet.MARGIN + figure_w + sheet.GAP
head_row = floor - sheet.HEIGHT + round((156 - 101) * scale)
for x in (sheet.MARGIN + figure_w // 2, back_x + figure_w // 2):
    # Both keep their heads, at one height.
    assert tuple(out[head_row, x]) == (120, 80, 60), x
    # Both stand on the floor line: their trousers end on it (Lanczos blends the few rows at the edge itself).
    assert np.abs(out[floor - 8, x].astype(int) - (40, 40, 60)).max() <= 2, out[floor - 8, x]
    assert np.abs(out[floor + 8, x].astype(int) - WHITE).max() <= 2, out[floor + 8, x]
# The face fills its square, from the top margin to the floor line.
face_x = out.shape[1] - sheet.MARGIN - sheet.HEIGHT
assert tuple(out[sheet.MARGIN + 450, face_x + 512]) == (120, 80, 60)
# A face that is not square goes as its middle square.
tall = np.full((1536, 1024, 3), WHITE, np.uint8)
cv2.circle(tall, (512, 768), 300, (120, 80, 60), -1)
assert tuple(sheet.simple_sheet(front, back, tall)[sheet.MARGIN + 512, face_x + 512]) == (120, 80, 60)
# A shirt nearly as white as the background is not cut away: the sheet keeps its pixels.
light = figure(shirt=(244, 244, 246))
kept = sheet.simple_sheet(light, back, face)
assert tuple(kept[floor - round((900 - 500) * scale), sheet.MARGIN + 100]) == (244, 244, 246)

# A rectangle whose white is a few levels off the canvas's fades into it: no step at the rectangle's edge.
dim = figure(background=(240, 240, 242))
mixed = sheet.simple_sheet(front, dim, face)
row = sheet.MARGIN + 30
assert np.abs(mixed[row, back_x - 2:back_x + 3].astype(int) - WHITE).max() <= 2, mixed[row, back_x - 2:back_x + 3]

# A picture whose background does not come off (no plain border) goes whole.
noise = np.random.default_rng(3).integers(0, 255, (400, 300, 3), dtype=np.uint8)
whole, box = sheet._figure(noise)
assert whole.min() == 1.0 and box == (0, 400, 0, 300)
print("sheet: ok")
