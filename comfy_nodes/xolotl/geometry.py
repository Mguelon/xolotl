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
    give the same scale, the smaller one wins: fewer padded pixels to generate.
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
        scale = min(limit_w / width, limit_h / height)
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
