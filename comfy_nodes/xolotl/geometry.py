"""Where a clip sits on the model's canvas: pure Python, no ComfyUI imports, so the tests run anywhere.

The Akatz pack's PrepareVideo fills its canvas and centre-crops whatever does not fit. Xólotl fits the whole frame
instead (contain) and pads the rest, so nothing of the shot is lost and the result can go back to the clip's own size.
"""
from __future__ import annotations

PIXEL_BUDGETS = {"480": 500_000, "768": 1_000_000}  # the pack's budgets (video.py PIXEL_BUDGETS)
GRID = 32  # the pack keeps canvases on a 32-pixel grid


def fit_canvas(width: float, height: float, resolution: str) -> dict:
    """The grid canvas within the budget that holds the whole frame at the largest scale, and the frame's box on it.

    Returns {"canvas": [w, h], "box": [x, y, w, h]} with even box sizes and offsets (4:2:0 video). Among canvases that
    give the same scale, the smaller one wins: fewer padded pixels to generate. Nothing is scaled up: a clip or crop
    smaller than the budget keeps its own pixels on the smallest grid canvas that holds it (the result goes back to
    that size anyway, so bigger would only cost tokens).
    """
    if resolution not in PIXEL_BUDGETS:
        raise ValueError("Choose 480 or 768.")
    if not (width > 0 and height > 0):
        raise ValueError("The clip has no picture size.")
    budget = PIXEL_BUDGETS[resolution]
    ceil_grid = lambda v: -(-int(round(v)) // GRID) * GRID
    best = None
    for limit_h in range(GRID, budget // GRID + 1, GRID):
        limit_w = budget // limit_h // GRID * GRID
        if limit_w < GRID:
            break
        scale = min(limit_w / width, limit_h / height, 1.0)
        box_w = min(limit_w, max(2, round(width * scale / 2) * 2))
        box_h = min(limit_h, max(2, round(height * scale / 2) * 2))
        canvas_w, canvas_h = min(limit_w, ceil_grid(box_w)), min(limit_h, ceil_grid(box_h))
        key = (round(scale, 9), -(canvas_w * canvas_h))
        if best is None or key > best[0]:
            best = (key, canvas_w, canvas_h, box_w, box_h)
    _, canvas_w, canvas_h, box_w, box_h = best
    x = (canvas_w - box_w) // 4 * 2
    y = (canvas_h - box_h) // 4 * 2
    return {"canvas": [canvas_w, canvas_h], "box": [x, y, box_w, box_h]}


def person_box(bbox, fit: dict, margin: float = 0.2, min_aspect: float = 9 / 16, max_aspect: float = 16 / 9) -> dict:
    """Where to crop the clip around the person, in the clip's own pixels, so the swap spends its canvas on them.

    bbox: [x0, y0, x1, y1], the union of the person's masks over every frame, in pixels of the canvas `fit`
    describes (x1 and y1 exclusive); empty or outside the clip gives the whole frame. margin: room per side as a
    fraction of the box's longer side: the character may have bigger hair or clothes than the person, and the swap's
    mask grows on the canvas. The crop's width / height is kept between min_aspect and max_aspect (portrait to
    landscape phone formats by default), as far as the frame allows. Returns {"x", "y", "w", "h"}, even and inside
    the frame.
    """
    width, height = fit["width"], fit["height"]
    bx, by, bw, bh = fit["box"]
    whole = {"x": 0, "y": 0, "w": width, "h": height}
    if not bbox or bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
        return whole
    sx, sy = width / bw, height / bh
    x0, x1 = (min(max((v - bx) * sx, 0), width) for v in (bbox[0], bbox[2]))
    y0, y1 = (min(max((v - by) * sy, 0), height) for v in (bbox[1], bbox[3]))
    if x1 <= x0 or y1 <= y0:
        return whole  # the mask sat in the padding
    pad = margin * max(x1 - x0, y1 - y0)
    x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    w, h = x1 - x0, y1 - y0
    if min_aspect > 0 and w < h * min_aspect:
        w = min(width, h * min_aspect)
    if max_aspect > 0 and h < w / max_aspect:
        h = min(height, w / max_aspect)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, h = min(w, width), min(h, height)
    x0, y0 = min(max(cx - w / 2, 0), width - w), min(max(cy - h / 2, 0), height - h)
    left, top = int(x0 // 2 * 2), int(y0 // 2 * 2)
    right, bottom = min(width, -(-int(x0 + w) // 2) * 2), min(height, -(-int(y0 + h) // 2) * 2)
    return {"x": left, "y": top, "w": right - left, "h": bottom - top}
