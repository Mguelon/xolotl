"""The person's mask grown by an exact Euclidean radius: the same masks as the pack's ExpandMask (scipy's distance
transform <= radius), with OpenCV's exact distance transform over a few threads. numpy and OpenCV only, both of
which ComfyUI ships, so it is tested without ComfyUI."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

WORKERS = 8  # OpenCV releases the GIL; more threads than this gained nothing on 24 cores


def _grow_one(mask: np.ndarray, radius: int) -> np.ndarray:
    outside = (~mask).astype(np.uint8)  # zero on the person: each pixel's distance to them
    if not radius or outside.all():
        return mask.copy()
    if not outside.any():
        return np.ones_like(mask)
    # DIST_MASK_PRECISE is the exact Euclidean transform (Felzenszwalb): squared distances are integers, so the
    # float32 distances compare with the radius exactly, as scipy's float64 ones do
    return cv2.distanceTransform(outside, cv2.DIST_L2, cv2.DIST_MASK_PRECISE) <= radius


def grow(binary: np.ndarray, radius: int, workers: int = WORKERS) -> np.ndarray:
    """Every pixel within `radius` (Euclidean, pixel centres) of a True pixel, for a [frames, height, width] bool."""
    with ThreadPoolExecutor(workers) as pool:
        return np.stack(list(pool.map(lambda mask: _grow_one(mask, radius), binary)))
