"""The character's simple sheet: the whole front, the whole back and the face big, in one picture.

Mike's design (2026-11-03, after atelier's api/core/personaje.py componer_hoja_simple): one picture to give H3 as the
character, all from the front: the figure from the front, head to toe, and the back and a close-up of the face drawn
from it (the face at its own resolution, not cut from the front and enlarged). H3 shrinks each reference whole to the
take's pixels, so the sheet has no labels and no spare margins: the front and the back stand on one floor line at one
scale, and the face is a square as tall as them.

The creator draws every picture on a plain white background. Each figure is found on it by colour (what is close to
the border's colour and connected to the border is background) but not cut out of it: it goes as a rectangle around
it, faded into the canvas at its border, so white clothes on the white background lose nothing.
"""
from __future__ import annotations

import cv2
import numpy as np

MARGIN, GAP, HEIGHT = 40, 48, 1024
PAD = 0.02  # room around each figure's rectangle, as a share of its height, so its outline is not shaved
SOFT, HARD = 6.0, 22.0  # RGB distance to the background's colour: under SOFT background, over HARD figure, soft between


def border_color(picture: np.ndarray) -> np.ndarray:
    """The background's colour: the median of a ring 2 % wide around the picture."""
    h, w = picture.shape[:2]
    b = max(2, round(0.02 * min(h, w)))
    ring = np.concatenate([picture[:b].reshape(-1, 3), picture[-b:].reshape(-1, 3),
                           picture[:, :b].reshape(-1, 3), picture[:, -b:].reshape(-1, 3)])
    return np.median(ring.astype(np.float32), axis=0)


def figure_alpha(picture: np.ndarray, color: np.ndarray | None = None) -> np.ndarray:
    """0..1, the figure against the plain background (`color`, or the picture's border). Soft over the last levels, so
    the outline keeps its antialiasing."""
    distance = np.linalg.norm(picture.astype(np.float32) - (border_color(picture) if color is None else color), axis=2)
    near = (distance < HARD).astype(np.uint8)
    _, labels = cv2.connectedComponents(near, connectivity=4)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    outside = np.isin(labels, edge[edge > 0])
    alpha = np.ones(distance.shape, np.float32)
    alpha[outside] = np.clip((distance[outside] - SOFT) / (HARD - SOFT), 0, 1)
    return alpha


def bounds(alpha: np.ndarray, minimum: int = 3) -> tuple[int, int, int, int]:
    """(top, bottom, left, right) of the figure: rows and columns with at least `minimum` solid pixels."""
    solid = alpha > 0.5
    rows = np.nonzero(solid.sum(axis=1) >= minimum)[0]
    cols = np.nonzero(solid.sum(axis=0) >= minimum)[0]
    if not rows.size or not cols.size:
        return 0, alpha.shape[0], 0, alpha.shape[1]
    return int(rows[0]), int(rows[-1]) + 1, int(cols[0]), int(cols[-1]) + 1


def _figure(picture: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    """The picture's figure alpha and bounds; a picture whose background is not found (less than 3 % or more than
    97 % of it figure) counts as all figure."""
    alpha = figure_alpha(picture)
    share = float((alpha > 0.5).mean())
    if not 0.03 <= share <= 0.97:
        alpha = np.ones(alpha.shape, np.float32)
    return alpha, bounds(alpha)


def _scaled(piece: np.ndarray, width: int, height: int) -> np.ndarray:
    method = cv2.INTER_AREA if height < piece.shape[0] else cv2.INTER_LANCZOS4
    return cv2.resize(piece, (max(1, width), max(1, height)), interpolation=method)


def _standing(picture: np.ndarray) -> tuple[np.ndarray, float]:
    """The figure's rectangle, with room around it, scaled so the figure is HEIGHT tall from head to toe, and the row
    of its feet in it."""
    _, (top, bottom, left, right) = _figure(picture)
    pad = round(PAD * (bottom - top))
    h, w = picture.shape[:2]
    first = max(top - pad, 0)
    piece = picture[first:min(bottom + pad, h), max(left - pad, 0):min(right + pad, w)]
    scale = HEIGHT / (bottom - top)
    return _scaled(piece, round(piece.shape[1] * scale), round(piece.shape[0] * scale)), (bottom - first) * scale


def simple_sheet(front: np.ndarray, back: np.ndarray, face: np.ndarray) -> np.ndarray:
    """The sheet (RGB uint8). `front`, `back` and `face` (the close-up) are RGB uint8 pictures on the plain
    background; the face goes whole, or its middle square if it is not square."""
    color = border_color(front)
    figures = [_standing(front), _standing(back)]
    side = min(face.shape[:2])
    y0, x0 = (face.shape[0] - side) // 2, (face.shape[1] - side) // 2
    portrait = _scaled(face[y0:y0 + side, x0:x0 + side], HEIGHT, HEIGHT)

    width = 2 * MARGIN + sum(piece.shape[1] for piece, _ in figures) + HEIGHT + 2 * GAP
    canvas = np.empty((2 * MARGIN + HEIGHT, width, 3), np.uint8)
    canvas[:] = np.round(color).astype(np.uint8)
    floor = MARGIN + HEIGHT
    # Each rectangle fades into the canvas over its border, so none shows where its white is a few levels off.
    fade = max(1, round(PAD * HEIGHT))
    x = MARGIN
    for piece, feet in figures:  # the feet on the floor line
        _place(canvas, _feathered(piece, color, fade), x, round(floor - feet))
        x += piece.shape[1] + GAP
    _place(canvas, _feathered(portrait, color, fade), x, MARGIN)
    return canvas


def _feathered(piece: np.ndarray, color: np.ndarray, width: int) -> np.ndarray:
    """`piece` faded into `color` over its outer `width` pixels."""
    h, w = piece.shape[:2]
    ys, xs = np.arange(h, dtype=np.float32)[:, None], np.arange(w, dtype=np.float32)[None, :]
    edge = np.minimum(np.minimum(xs, w - 1 - xs), np.minimum(ys, h - 1 - ys))
    weight = np.clip(edge / width, 0, 1)[:, :, None]
    return (piece * weight + color * (1 - weight)).round().astype(np.uint8)


def _place(canvas: np.ndarray, piece: np.ndarray, x: int, y: int) -> None:
    """`piece` on the canvas at (x, y), whatever of it falls outside left out."""
    h, w = piece.shape[:2]
    y0, x0 = max(y, 0), max(x, 0)
    y1, x1 = min(y + h, canvas.shape[0]), min(x + w, canvas.shape[1])
    canvas[y0:y1, x0:x1] = piece[y0 - y:y1 - y, x0 - x:x1 - x]
