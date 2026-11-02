"""Times, on CPU inside the ComfyUI container, the work between the person's tracking and the first window: the
pack's mask expansion (an exact Euclidean dilation per frame) with the colour overlay it also returns, the same
expansion spread over threads or done with OpenCV's exact distance transform (each must give the very same masks),
Xólotl's exact growth with OpenCV over threads (comfy_nodes/xolotl/masks.py), and the pack's tensor hash of the
prepared clip. Synthetic masks: an ellipse the
size of a framed person, walking across the canvas.

  docker cp scripts/time-prep.py comfyui:/tmp/ && docker exec -w /root/ComfyUI comfyui python3.13 /tmp/time-prep.py \
      --pack custom_nodes/h3_character_swap --nodes custom_nodes/xolotl --frames 243 --width 896 --height 512 --radius 64
"""
import argparse
import importlib.util
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, "/root/ComfyUI")
import numpy as np  # noqa: E402
import torch  # noqa: E402
from scipy.ndimage import distance_transform_edt  # noqa: E402


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def timed(fn, *args):
    start = time.perf_counter()
    out = fn(*args)
    return out, round(time.perf_counter() - start, 3)


def threaded_expand(raw, radius, workers):
    def one(mask):
        binary = mask > 0.5
        return (distance_transform_edt(~binary) <= radius) if radius and binary.any() else binary
    with ThreadPoolExecutor(workers) as pool:
        return np.stack(list(pool.map(one, raw))).astype(np.float32)


def opencv_expand(raw, radius):
    import cv2
    out = np.empty(raw.shape, np.float32)
    for i, mask in enumerate(raw):
        outside = (mask <= 0.5).astype(np.uint8)  # zero on the person: the distance to them
        if radius and outside.min() == 0:
            out[i] = cv2.distanceTransform(outside, cv2.DIST_L2, cv2.DIST_MASK_PRECISE) <= radius
        else:
            out[i] = mask > 0.5
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack", required=True)
    parser.add_argument("--nodes", required=True, help="the directory with Xólotl's masks.py")
    parser.add_argument("--frames", type=int, default=243)
    parser.add_argument("--width", type=int, default=896)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--radius", type=int, default=64)
    args = parser.parse_args()
    masks_py = load(f"{args.pack}/masks.py", "pack_masks")
    identity_py = load(f"{args.pack}/identity.py", "pack_identity")
    n, h, w = args.frames, args.height, args.width
    yy, xx = np.mgrid[0:h, 0:w]
    raw = np.stack([(((xx - (0.3 + 0.4 * i / n) * w) / (0.17 * w)) ** 2 + ((yy - 0.55 * h) / (0.42 * h)) ** 2 <= 1)
                    for i in range(n)]).astype(np.float32)
    images = torch.rand(n, h, w, 3)
    report = {"frames": n, "size": [w, h], "radius": args.radius, "person_share": round(float((raw > 0.5).mean()), 3)}
    expanded, report["pack_expand_s"] = timed(masks_py.expand_masks, raw, args.radius)
    tensor = torch.from_numpy(expanded)
    _, report["pack_overlay_s"] = timed(lambda: torch.where(tensor[..., None] > 0,
                                                            images * .65 + torch.tensor([.1, .9, .4]) * .35, images))
    for workers in (8, 24):
        threaded, report[f"threads_{workers}_expand_s"] = timed(threaded_expand, raw, args.radius, workers)
        assert np.array_equal(threaded, expanded), "threads must give the very same masks"
    fast, report["opencv_expand_s"] = timed(opencv_expand, raw, args.radius)
    assert np.array_equal(fast, expanded), "OpenCV must give the very same masks"
    noisy = raw.copy()
    noisy[:, ::7, ::5] = 1 - noisy[:, ::7, ::5]  # scattered specks: many small regions and holes
    assert np.array_equal(opencv_expand(noisy, args.radius), masks_py.expand_masks(noisy, args.radius)), "specks too"
    grow = load(f"{args.nodes}/masks.py", "xolotl_masks").grow
    binary = raw > 0.5
    for workers in (1, 8, 24):
        mine, report[f"xolotl_grow_{workers}_s"] = timed(grow, binary, args.radius, workers)
        assert np.array_equal(mine.astype(np.float32), expanded), "Xólotl's growth must give the very same masks"
    _, report["pack_tensor_hash_s"] = timed(identity_py.tensor_hash, images)
    print(json.dumps(report))


if __name__ == "__main__":
    main()
