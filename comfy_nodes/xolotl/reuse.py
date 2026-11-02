"""A VAE that does not encode the same pixels twice in a row. Torch only, so it is tested without ComfyUI."""
from __future__ import annotations

import copy
import logging

import torch

MIN_FRAMES = 5  # only clips are kept: a still image costs little to encode again


def eight_bit(pixels: torch.Tensor) -> torch.Tensor:
    """The pixels as ComfyUI's lanczos resize hands them back at the same size: x 255, clipped, truncated to uint8
    (comfy.utils.lanczos), / 255."""
    return (pixels * 255.0).clamp(0, 255).to(torch.uint8).to(pixels.dtype) / 255.0


def reusing_encodes(vae):
    """A shallow copy of `vae` whose encode returns the previous encode's latent when it gets the same frames again.

    The same frames: equal in shape, dtype, device and every value, or the previous encode's pixels are these
    rounded down to 8 bits (`eight_bit`). The pack encodes the first window's frames twice, first as H3's reference
    video, which ComfyUI's resize has rounded down to 8 bits even at the same size, then as they are, for the
    latent kept outside the person: that second encode gets the reference's latent, the same frames at most 1/255
    darker. The kept pixels and latent are copies, so nothing the callers do afterwards changes them. One clip is
    kept at a time; a reuse or a decode drops it.
    """
    wrapped = copy.copy(vae)
    encode, decode = type(vae).encode, type(vae).decode
    kept = {}

    def reuse_encode(pixel_samples):
        pixels = kept.get("pixels")
        if (pixels is not None and pixels.shape == pixel_samples.shape and pixels.dtype == pixel_samples.dtype
                and pixels.device == pixel_samples.device):
            same = torch.equal(pixels, pixel_samples)
            if same or torch.equal(pixels, eight_bit(pixel_samples)):
                latent = kept["latent"]
                kept.clear()
                logging.info("Xólotl: reused the VAE encode of %s pixels (%s)", "×".join(map(str, pixel_samples.shape)),
                             "the same" if same else "the same rounded down to 8 bits")
                return latent
        kept.clear()
        latent = encode(wrapped, pixel_samples)
        if pixel_samples.ndim == 4 and pixel_samples.shape[0] >= MIN_FRAMES:
            kept.update(pixels=pixel_samples.clone(), latent=latent.clone())
        return latent

    def forget_on_decode(*args, **kwargs):
        kept.clear()  # a window ends with its decode: what it encoded is not needed again
        return decode(wrapped, *args, **kwargs)

    wrapped.encode = reuse_encode
    wrapped.decode = forget_on_decode
    return wrapped
