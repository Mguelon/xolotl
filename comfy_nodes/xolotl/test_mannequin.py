"""The grey mannequin, without ComfyUI (numpy and OpenCV):
  docker cp comfy_nodes/xolotl comfyui:/tmp/xolotl-test && docker exec comfyui python3.13 /tmp/xolotl-test/test_mannequin.py"""
import importlib.util
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location("mannequin", Path(__file__).with_name("mannequin.py"))
mannequin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mannequin)

rng = np.random.default_rng(7)
frames = rng.random((3, 96, 64, 3), dtype=np.float32)
masks = np.zeros((3, 96, 64), np.float32)
masks[:, 20:80, 16:48] = 1
out = mannequin.mannequins(frames, masks)
assert out.shape == frames.shape and out.dtype == np.float32
outside = masks == 0
assert np.array_equal(out[outside], frames[outside]), "the scene stays as it is"
inside = out[masks == 1]
assert np.allclose(inside[:, 0], inside[:, 1]) and np.allclose(inside[:, 1], inside[:, 2]), "the person is grey"
assert 0.45 <= inside.min() and inside.max() <= 0.9, "mid-grey, the shading kept"
assert inside.std() < frames[masks == 1].std() / 4, "the clothes' texture is gone"
# a soft mask edge is halfway between the scene and the grey figure
full = mannequin.paint(frames[0], np.ones((96, 64), np.float32))
soft = mannequin.paint(frames[0], np.full((96, 64), 0.5, np.float32))
assert np.allclose(soft, (frames[0] + full) / 2, atol=1e-6)
# the face keeps finer detail than the body
detailed = mannequin.paint(frames[0], masks[0], np.array([[22, 32, 20, 16]], np.float32), face_blur=0.0)
assert detailed[30:50, 20:44].std() > detailed[60:80, 20:44].std() * 2, "a sharper face than body"
print("mannequin: ok")
