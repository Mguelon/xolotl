"""Checks reuse.py with a stand-in VAE. Needs torch: inside the ComfyUI container,
  docker cp comfy_nodes/xolotl comfyui:/tmp/xolotl-test && docker exec comfyui python3.13 /tmp/xolotl-test/test_reuse.py
"""
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
from reuse import eight_bit, reusing_encodes  # noqa: E402


class StandIn:
    def __init__(self):
        self.encodes = self.decodes = 0
        self.patcher = object()

    def encode(self, pixels):
        self.encodes += 1
        return pixels.mean(dim=(1, 2), keepdim=True) * 2

    def decode(self, latent):
        self.decodes += 1
        return latent / 2


vae = StandIn()
wrapped = reusing_encodes(vae)
assert wrapped is not vae and wrapped.patcher is vae.patcher, "a shallow copy: same weights, same patcher"
assert vae.encode.__func__ is StandIn.encode, "the original VAE is left alone"
clip = torch.rand(124, 32, 48, 3)
first = wrapped.encode(clip)
assert wrapped.encodes == 1
again = wrapped.encode(clip.clone())
assert wrapped.encodes == 1 and torch.equal(again, first), "the same pixels: no second encode, the same latent"
wrapped.encode(clip.clone())
assert wrapped.encodes == 2, "a reuse drops what it kept"
changed = clip.clone()
changed[60, 10, 10, 0] += 1 / 255
wrapped.encode(changed)
assert wrapped.encodes == 3, "one value off by one level: encoded"
wrapped.encode(changed[:-1].clone())
assert wrapped.encodes == 4, "another length: encoded"
latent = wrapped.encode(clip)
latent += 1  # a caller changing its latent in place does not reach the kept copy
assert torch.equal(wrapped.encode(clip.clone()), first), "the kept latent is a copy"
wrapped.encode(clip)
wrapped.decode(first)
wrapped.encode(clip.clone())
assert wrapped.encodes == 7 and wrapped.decodes == 1, "a decode drops what was kept"
source = torch.rand(124, 32, 48, 3) * 0.999  # float frames, as ComfyUI decodes yuv420p (gbrpf32le)
reference = eight_bit(source)
assert not torch.equal(reference, source) and float((source - reference).max()) < 1 / 255 + 1e-6
n = wrapped.encodes
kept_latent = wrapped.encode(reference)
assert torch.equal(wrapped.encode(source), kept_latent) and wrapped.encodes == n + 1, \
    "the frames after their 8-bit reference: the reference's latent"
wrapped.encode(eight_bit(source))
wrapped.encode(source + 2 / 255)
assert wrapped.encodes == n + 3, "two levels brighter is not the same frames"
still = torch.rand(1, 32, 48, 3)
wrapped.encode(still)
wrapped.encode(still.clone())
assert wrapped.encodes == n + 5, "a still image is not kept"
print("reuse: ok")
