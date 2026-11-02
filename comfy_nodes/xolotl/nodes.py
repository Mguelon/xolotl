"""Xólotl's nodes around the Akatz H3 character-swap pack.

XolotlFitVideo puts the whole clip, or a crop of it, on the model's canvas (contain and pad, never cut), so H3
Prepare Video keeps it as it is. XolotlPersonBox turns the masks of a first pass over the whole frame into that crop:
the person with some room, so the canvas's pixels go to them instead of the scenery. XolotlMapMasks carries the first
pass's masks onto the crop's canvas, so the person is tracked once. XolotlRestoreSize lays the swap back over the
clip's own frames, at the clip's own size and place, through the region the swap regenerated: everything outside it
stays the original footage until the final encode. XolotlGrowMasks grows the person's mask as the pack's Expand
Person Mask does, in a fraction of the time, and XolotlReuseEncodes keeps the pack from encoding the same frames twice.
XolotlFaceCrop cuts the character's face from its picture and enlarges it, the close-up that keeps it on the person.
XolotlMannequin turns the clip's person grey in the reference H3 copies the motion from, so it does not copy their looks.
XolotlNeutralFace gives LivePortrait the clip's calmest face to measure the gestures against.

Both nodes cut and decode the original file with the same ffmpeg options, so they see the same frames, and neither
goes through the H.264 copy ComfyUI makes of a sliced clip. ffmpeg does the pixel work, as in the pack, so a long
1080p clip never sits in memory as float tensors.
"""
from __future__ import annotations

import json
import logging
import subprocess
import tempfile
import uuid
from fractions import Fraction
from pathlib import Path

import folder_paths
import numpy as np
import torch
import torch.nn.functional as F
from comfy_api.latest._input_impl.video_types import VideoFromFile

from .geometry import PIXEL_BUDGETS, face_square, fit_canvas, person_box
from .expressions import neutral_index
from .mannequin import mannequins
from .masks import grow as grow_masks
from .reuse import reusing_encodes

FPS = 24  # the pack generates at 24 fps (video.py FPS)
TIMELINE = f"setpts=PTS-STARTPTS,fps=fps={FPS}:round=near:eof_action=round"  # the pack's own resampling
# ffprobe's colour matrix -> the scale filter's name. ComfyUI decodes with PyAV, which converts with the matrix the
# frames are tagged with and falls back to libswscale's BT.601 when they carry none: the swap is in that RGB.
MATRICES = {"bt709": "bt709", "smpte170m": "bt601", "bt470bg": "bt601", "bt2020nc": "bt2020", "bt2020c": "bt2020",
            "fcc": "fcc", "smpte240m": "smpte240m"}
COLOR_FLAGS = (("-colorspace", "color_space"), ("-color_primaries", "color_primaries"),
               ("-color_trc", "color_transfer"), ("-color_range", "color_range"))
CHUNK = 16  # frames per write to ffmpeg


def _workdir() -> Path:
    directory = Path(folder_paths.get_temp_directory()) / "xolotl"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _source(video, directory: Path) -> tuple[str, float, float]:
    """The original file and the Video Slice window on it. A copy only when ComfyUI holds no file or a crop."""
    path = video.get_stream_source()
    start, duration = video.get_active_trim_window()
    if isinstance(path, str) and getattr(video, "_VideoFromFile__crop", None) is None:
        return path, float(start or 0), float(duration or 0)
    copy = directory / f"source-{uuid.uuid4().hex}.mkv"
    video.save_to(str(copy))  # ComfyUI applies its trim and crop here (H.264, crf 18)
    return str(copy), 0.0, 0.0


def _input(fit: dict) -> list[str]:
    """The same cut of the original for both nodes: accurate input seek, then the pack's timeline."""
    window = ["-ss", f"{fit['start']:.6f}"] if fit["start"] else []
    if fit["duration"]:
        window += ["-t", f"{fit['duration']:.6f}"]
    return [*window, "-i", fit["source"]]


def _probe(path: str) -> dict:
    result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", path],
                            check=True, capture_output=True, timeout=30)
    return json.loads(result.stdout)


def _picture(stream: dict) -> tuple[int, int, bool]:
    """Width and height as shown (non-square pixels and rotation applied, even for 4:2:0), and whether ffmpeg's
    decoded frames need a scale to get there."""
    try:
        sar = float(Fraction(stream.get("sample_aspect_ratio", "1:1").replace(":", "/")))
    except (ValueError, ZeroDivisionError):
        sar = 1.0
    sar = sar if sar > 0 else 1.0
    coded_w, coded_h = stream["width"], stream["height"]
    rotation = next((s["rotation"] for s in stream.get("side_data_list", []) if "rotation" in s), 0)
    width, height = coded_w * sar, coded_h
    if round(rotation) % 180 == 90:
        width, height, coded_w, coded_h = height, width, coded_h, coded_w
    width, height = max(2, int(width) // 2 * 2), max(2, int(height) // 2 * 2)
    return width, height, (coded_w, coded_h) != (width, height) or abs(sar - 1) > 1e-9


def _ffmpeg(args: list[str], timeout: int = 900) -> None:
    try:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *args],
                       check=True, capture_output=True, timeout=timeout)
    except subprocess.CalledProcessError as error:
        raise ValueError("ffmpeg failed: " + error.stderr.decode(errors="replace")[-1200:]) from error


def _ffmpeg_fed(args: list[str], chunks, timeout: int = 1800) -> None:
    """ffmpeg reading raw frames from stdin, written a few at a time; its log goes to a file, so no pipe fills up."""
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *args],
                                   stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=log)
        try:
            for chunk in chunks:
                process.stdin.write(chunk)
            process.stdin.close()
        except BrokenPipeError:
            pass  # ffmpeg stopped reading: its exit code and log say why
        except BaseException:
            process.kill()
            process.wait()
            raise
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise ValueError("ffmpeg took too long putting the clip back at its size.")
        if process.returncode:
            log.seek(0)
            raise ValueError("ffmpeg failed: " + log.read().decode(errors="replace")[-1200:])


def _rgba(images, masks):
    """The swap as RGBA bytes, the mask in the alpha channel, CHUNK frames at a time."""
    for start in range(0, images.shape[0], CHUNK):
        rgb = images[start:start + CHUNK, ..., :3].float().cpu()
        alpha = masks[start:start + CHUNK].float().cpu().unsqueeze(-1)
        yield (torch.cat([rgb, alpha], dim=-1).clamp(0, 1) * 255).round().to(torch.uint8).numpy().tobytes()


class XolotlFitVideo:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "video": ("VIDEO",),
            "resolution": (list(PIXEL_BUDGETS), {"default": "480",
                "tooltip": "The same budget as H3 Prepare Video: 480 = up to 0.5 MP, 768 = up to 1.0 MP."}),
        }, "optional": {
            "crop": ("XOLOTL_BOX", {"tooltip": "The part of the clip to put on the canvas (Xólotl Frame the Person); "
                                              "the whole clip without it."}),
        }}

    RETURN_TYPES = ("VIDEO", "XOLOTL_FIT")
    RETURN_NAMES = ("fitted_video", "fit")
    FUNCTION = "fit"
    CATEGORY = "Xólotl"
    DESCRIPTION = ("Fits the whole clip, or the crop around the person, on a 32-pixel grid canvas within the budget, "
                   "keeping its aspect ratio, and fills the few leftover pixels by mirroring the edge. H3 Prepare "
                   "Video then keeps it as it is.")

    def fit(self, video, resolution, crop=None):
        directory = _workdir()
        path, start, duration = _source(video, directory)
        streams = _probe(path)["streams"]
        picture = next((s for s in streams if s.get("codec_type") == "video"), None)
        if picture is None:
            raise ValueError("The clip has no video stream.")
        width, height, rescale = _picture(picture)
        crop = [crop["x"], crop["y"], crop["w"], crop["h"]] if crop else [0, 0, width, height]
        if crop[0] < 0 or crop[1] < 0 or crop[2] < 2 or crop[3] < 2 or crop[0] + crop[2] > width or crop[1] + crop[3] > height:
            raise ValueError(f"The crop {crop} does not fit in the {width}x{height} clip.")
        placement = fit_canvas(crop[2], crop[3], resolution)
        (canvas_w, canvas_h), (x, y, box_w, box_h) = placement["canvas"], placement["box"]
        right, bottom = canvas_w - box_w - x, canvas_h - box_h - y
        fit = {**placement, "width": width, "height": height, "crop": crop, "rescale": rescale, "source": path,
               "start": start, "duration": duration, "audio": any(s.get("codec_type") == "audio" for s in streams),
               "pix_fmt": picture.get("pix_fmt", ""), "color": {key: picture.get(key) for _, key in COLOR_FLAGS}}
        cropping = crop != [0, 0, width, height]
        filters = TIMELINE
        if cropping:  # cut in the clip's own pixels: non-square pixels and rotation first, if the clip has them
            filters += (f",scale={width}:{height}:flags=bicubic,setsar=1" if rescale else "") + \
                       f",crop={crop[2]}:{crop[3]}:{crop[0]}:{crop[1]}"
        filters += f",scale={box_w}:{box_h}:flags=lanczos,setsar=1,pad={canvas_w}:{canvas_h}:{x}:{y}"
        if x or y or right or bottom:
            filters += f",fillborders=left={x}:right={right}:top={y}:bottom={bottom}:mode=mirror"
        audio = ["-map", "0:a:0", "-af", "asetpts=PTS-STARTPTS", "-c:a", "pcm_s16le"] if fit["audio"] else []
        output = directory / f"fit-{uuid.uuid4().hex}.mkv"
        _ffmpeg([*_input(fit), "-map", "0:v:0", *audio, "-vf", filters, "-c:v", "ffv1", str(output)], timeout=600)
        return (VideoFromFile(str(output)), fit)


class XolotlMapMasks:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "masks": ("MASK", {"tooltip": "The person's masks on the first pass's canvas (H3 Recover Masks)."}),
            "first": ("XOLOTL_FIT", {"tooltip": "The first pass's Fit Clip on Canvas."}),
            "fit": ("XOLOTL_FIT", {"tooltip": "The crop's Fit Clip on Canvas."}),
        }}

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("masks",)
    FUNCTION = "map"
    CATEGORY = "Xólotl"
    DESCRIPTION = ("The first pass's masks moved onto the crop's canvas, so the person is tracked once: the mask is "
                   "only a region to regenerate and composite, grown by 64 px afterwards.")

    def map(self, masks, first, fit):
        (w0, h0), (bx0, by0, bw0, bh0) = first["canvas"], first["box"]
        (w1, h1), (bx1, by1, bw1, bh1) = fit["canvas"], fit["box"]
        if tuple(masks.shape[1:3]) != (h0, w0):
            raise ValueError(f"Masks {tuple(masks.shape[1:3])} are not on the first canvas {h0}x{w0}.")
        cx, cy, cw, ch = fit.get("crop") or [0, 0, fit["width"], fit["height"]]
        # The crop in the first canvas's pixels (fractional), sampled onto the crop's box with bilinear filtering.
        sx, sy = bw0 / first["width"], bh0 / first["height"]
        x0, y0, x1, y1 = bx0 + cx * sx, by0 + cy * sy, bx0 + (cx + cw) * sx, by0 + (cy + ch) * sy
        us = (torch.arange(bw1, dtype=torch.float32) + 0.5) / bw1 * (x1 - x0) + x0
        vs = (torch.arange(bh1, dtype=torch.float32) + 0.5) / bh1 * (y1 - y0) + y0
        grid = torch.stack(torch.meshgrid(vs / h0 * 2 - 1, us / w0 * 2 - 1, indexing="ij")[::-1], dim=-1)  # x, y in -1..1
        out = torch.zeros((masks.shape[0], h1, w1), dtype=torch.float32)
        for start in range(0, masks.shape[0], 32):
            chunk = masks[start:start + 32].float().unsqueeze(1)
            sampled = F.grid_sample(chunk, grid.unsqueeze(0).expand(chunk.shape[0], -1, -1, -1), mode="bilinear",
                                    padding_mode="zeros", align_corners=False)
            out[start:start + 32, by1:by1 + bh1, bx1:bx1 + bw1] = sampled[:, 0]
        return (out.clamp(0, 1),)


class XolotlRestoreSize:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE", {"tooltip": "The swapped frames on the model's canvas (H3 Assemble)."}),
            "masks": ("MASK", {"tooltip": "The region the swap regenerated, on the same canvas (H3 Expand Mask)."}),
            "fit": ("XOLOTL_FIT", {"tooltip": "Where the clip sits on the canvas (Xólotl Fit Clip on Canvas)."}),
            "feather": ("FLOAT", {"default": 6.0, "min": 0.0, "max": 64.0, "step": 0.5,
                "tooltip": "Softness of the mask edge, in pixels of the output."}),
        }}

    RETURN_TYPES = ("VIDEO",)
    RETURN_NAMES = ("video",)
    FUNCTION = "restore"
    CATEGORY = "Xólotl"
    DESCRIPTION = ("Scales the swapped person back to the clip's own size and lays it over the clip's own frames, "
                   "at the crop's place when there was one, through the regenerated region, with the clip's sound: "
                   "the output has the input's size and aspect ratio, and everything outside the person is the "
                   "original footage, at 24 fps.")

    def restore(self, images, masks, fit, feather):
        (canvas_w, canvas_h), (x, y, box_w, box_h) = fit["canvas"], fit["box"]
        width, height = fit["width"], fit["height"]
        cx, cy, cw, ch = fit.get("crop") or [0, 0, width, height]  # where the canvas's picture sits on the clip
        count = images.shape[0]
        if tuple(images.shape[1:3]) != (canvas_h, canvas_w) or tuple(masks.shape[1:3]) != (canvas_h, canvas_w):
            raise ValueError(f"Frames {tuple(images.shape[1:3])} and masks {tuple(masks.shape[1:3])} must be on the "
                             f"fitted canvas {canvas_h}x{canvas_w}.")
        if masks.shape[0] < count:
            masks = torch.cat([masks, masks[-1:].expand(count - masks.shape[0], -1, -1)], dim=0)
        color = fit["color"]
        full_range = color.get("color_range") == "pc" or fit["pix_fmt"].startswith("yuvj")
        matrix = MATRICES.get(color.get("color_space") or "", "bt601")
        rescale = f",scale={width}:{height}:flags=bicubic,setsar=1" if fit["rescale"] else ""
        blur = f",gblur=sigma={feather}" if feather > 0 else ""
        graph = (
            f"[0:v]{TIMELINE}{rescale},trim=end_frame={count},format=pix_fmts=yuv420p|yuvj420p[clip];"
            f"[1:v]crop={box_w}:{box_h}:{x}:{y},split[c][a];"
            f"[c]scale={cw}:{ch}:flags=lanczos,format=gbrap[rgb];"
            f"[a]alphaextract,scale={cw}:{ch}:flags=bilinear{blur}[alpha];"
            f"[rgb][alpha]alphamerge,scale=out_color_matrix={matrix}:out_range={'pc' if full_range else 'tv'},"
            "format=yuva420p[swap];"
            f"[clip][swap]overlay=x={cx}:y={cy}:format=yuv420[out]"
        )
        # The clip is cut in the graph, not with -frames:v: that stops ffmpeg before the last audio packet is flushed.
        tags = [part for flag, key in COLOR_FLAGS if color.get(key) not in (None, "", "unknown", "reserved")
                for part in (flag, color[key])]
        audio = ["-map", "0:a:0", "-af", f"asetpts=PTS-STARTPTS,atrim=end={count / FPS:.6f}", "-c:a", "aac",
                 "-b:a", "192k"] if fit["audio"] else []
        output = _workdir() / f"restored-{uuid.uuid4().hex}.mp4"
        _ffmpeg_fed([*_input(fit), "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{canvas_w}x{canvas_h}",
                     "-r", str(FPS), "-i", "pipe:0", "-filter_complex", graph, "-map", "[out]", *audio,
                     "-c:v", "libx264", "-preset", "medium", "-crf", "16", *tags,
                     "-movflags", "+faststart", str(output)], _rgba(images[:count], masks[:count]))
        return (VideoFromFile(str(output)),)


class XolotlPersonBox:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "masks": ("MASK", {"tooltip": "The person's masks over the frames, on the canvas of a first pass over "
                                          "the whole clip (SAM 3 Track to Mask)."}),
            "fit": ("XOLOTL_FIT", {"tooltip": "That first pass's Xólotl Fit Clip on Canvas."}),
            "margin": ("FLOAT", {"default": 0.2, "min": 0.0, "max": 1.0, "step": 0.05,
                "tooltip": "Room around the person per side, as a fraction of their box's longer side."}),
            "min_aspect": ("FLOAT", {"default": 9 / 16, "min": 0.0, "max": 4.0, "step": 0.01,
                "tooltip": "The crop is widened to at least this width / height (9:16 = a portrait phone frame); 0 = off."}),
            "max_aspect": ("FLOAT", {"default": 16 / 9, "min": 0.0, "max": 4.0, "step": 0.01,
                "tooltip": "The crop is heightened to at most this width / height (16:9); 0 = off."}),
            "threshold": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05}),
        }}

    RETURN_TYPES = ("XOLOTL_BOX", "STRING")
    RETURN_NAMES = ("crop", "summary")
    FUNCTION = "frame"
    CATEGORY = "Xólotl"
    DESCRIPTION = ("The part of the clip to swap: the person's masks over every frame, with room, in the clip's own "
                   "pixels. A second Fit Clip on Canvas with this crop gives the person the canvas's pixels (up to "
                   "their native resolution) instead of the scenery, for the same model work.")

    def frame(self, masks, fit, margin, min_aspect, max_aspect, threshold):
        canvas_w, canvas_h = fit["canvas"]
        if tuple(masks.shape[1:3]) != (canvas_h, canvas_w):
            raise ValueError(f"Masks {tuple(masks.shape[1:3])} are not on the fitted canvas {canvas_h}x{canvas_w}.")
        anywhere = (masks > threshold).any(dim=0)
        rows, cols = torch.nonzero(anywhere.any(dim=1)).flatten(), torch.nonzero(anywhere.any(dim=0)).flatten()
        bbox = [int(cols.min()), int(rows.min()), int(cols.max()) + 1, int(rows.max()) + 1] if len(rows) else None
        crop = person_box(bbox, fit, margin, min_aspect, max_aspect)
        before = fit["box"][2] / fit["width"]
        after = min(1.0, fit_canvas(crop["w"], crop["h"], "480")["box"][2] / crop["w"])
        summary = (f"person box on the canvas: {bbox}\ncrop: {crop['w']}x{crop['h']} at ({crop['x']}, {crop['y']}) "
                   f"of {fit['width']}x{fit['height']}\nthe person's scale at 480p: {after:.3f} instead of {before:.3f}")
        return (crop, summary)


class XolotlGrowMasks:
    """The pack's Expand Person Mask without its cost: the same masks (every pixel within the radius of the person,
    Euclidean, at the prepared video's resolution), grown with OpenCV over a few threads, and without the colour
    overlay of the whole clip that the pack also returns and nothing reads. 243 frames at 896x512: 1.3 s instead of
    10.3 s; at 1024x768, 2.4 s instead of 22.4 s (scripts/time-prep.py). Same inputs, so it takes the pack's place.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"masks": ("MASK",), "images": ("IMAGE",),
                             "source_frames": ("INT", {"default": 120, "min": 1}),
                             "expansion_px": ("INT", {"default": 64, "min": 0, "max": 256})}}

    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("generation_mask",)
    FUNCTION = "grow"
    CATEGORY = "Xólotl"

    def grow(self, masks, images, source_frames, expansion_px):
        # the pack's own checks, with its messages (h3_character_swap/nodes.py, ExpandMask.expand)
        if not 1 <= source_frames <= len(images) or len(masks) < source_frames:
            raise ValueError("Masks must cover the complete source timeline.")
        if masks.shape[1:] != images.shape[1:3]:
            raise ValueError("Masks and prepared video dimensions differ.")
        raw = masks[:source_frames].detach().cpu().numpy()
        if not np.isfinite(raw).all():
            raise ValueError("Mask contains non-finite values.")
        binary = raw > 0.5
        missing = np.flatnonzero(~binary.any(axis=(1, 2))).tolist()
        if missing:
            raise ValueError(f"SAM lost the selected person at frames {missing[:20]}. Correct the selection or split "
                             "the source shot before generating.")
        grown = torch.from_numpy(grow_masks(binary, expansion_px).astype(np.float32))
        if len(images) > source_frames:
            grown = torch.cat([grown, grown[-1:].expand(len(images) - source_frames, -1, -1)])
        return (grown,)


class XolotlReuseEncodes:
    """The same VAE, except that encoding the pixels it has just encoded gives back that latent instead of a repeat.

    The pack encodes a window's source frames twice: as the reference video H3 follows, then as the latent kept
    outside the person. In the first window they are the same frames at the same size (the pack's resize to that
    size is an exact copy), so the second encode is a repeat: 26 s of a 5 s take at 480p on a 16 GB card. The match
    is exact and H3's video VAE returns the posterior mean, so the latent is the one the repeat would give.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"vae": ("VAE",)}}

    RETURN_TYPES = ("VAE",)
    FUNCTION = "wrap"
    CATEGORY = "Xólotl"
    DESCRIPTION = "Skips an encode of the very pixels the VAE has just encoded (the pack's first window does one)."

    def wrap(self, vae):
        return (reusing_encodes(vae),)


YUNET = Path(__file__).with_name("models") / "face_detection_yunet_2023mar.onnx"  # OpenCV Zoo, MIT (models/LICENSE-yunet)


class XolotlFaceCrop:
    """The character's face, cut from the character picture and enlarged: the close-up H3 gets as a second picture.

    With only a full-body picture the take kept the performer's face (Renata: 0.15 like her, 0.61 like the clip); with
    this close-up of her face beside it, 0.53 against 0.15, and the mouth followed the clip more closely
    (docs/measurements.md). YuNet finds the largest face and the square around it (geometry.face_square) is resized,
    with Lanczos when enlarged. A picture where it finds no face goes through whole, so a take never stops for it.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",),
                             "size": ("INT", {"default": 800, "min": 256, "max": 2048, "step": 16})}}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("close_up",)
    FUNCTION = "crop"
    CATEGORY = "Xólotl"
    DESCRIPTION = "The character's face, cut from its picture and enlarged, for H3's segment reference."

    def crop(self, image, size):
        import cv2  # OpenCV ships with ComfyUI's usual environments; only this node needs it

        picture = (image[0, :, :, :3].clamp(0, 1) * 255).round().to(torch.uint8).cpu().numpy()
        height, width = picture.shape[:2]
        detector = cv2.FaceDetectorYN.create(str(YUNET), "", (width, height), 0.6, 0.3, 50)
        _, faces = detector.detect(np.ascontiguousarray(picture[:, :, ::-1]))  # YuNet reads BGR
        if faces is None or not len(faces):
            logging.info("Xólotl: no face found in the character picture; it goes whole as the close-up")
            return (image[:1],)
        x0, y0, side = face_square(faces[np.argmax(faces[:, 2] * faces[:, 3])][:4], width, height)
        square = picture[y0:y0 + side, x0:x0 + side]
        method = cv2.INTER_LANCZOS4 if side < size else cv2.INTER_AREA
        close_up = cv2.resize(square, (size, size), interpolation=method)
        logging.info("Xólotl: the character's face close-up, %d px square at (%d, %d) of %d×%d", side, x0, y0, width,
                     height)
        return (torch.from_numpy(close_up).float().div(255).unsqueeze(0),)


class XolotlMannequin:
    """The person in H3's motion reference turned into a grey figure (mannequin.py, after D3voz's H3GreyMannequins,
    MIT): H3 follows the clip's motion without copying the performer's looks. With only the colours and the face of
    the clip to go on, the 13 s take drew the performer's cropped top, belly, hair and face for three seconds of a
    turn (docs/measurements.md). The face keeps finer detail (YuNet finds it) so the expressions still lead.
    Only the reference H3 reads changes: the result is laid over the clip's own frames.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "masks": ("MASK",),
                             "faces": ("BOOLEAN", {"default": True,
                                                   "tooltip": "Keep finer detail on the faces, for the expressions."}),
                             "face_blur": ("FLOAT", {"default": 0.05, "min": 0.0, "max": 0.5, "step": 0.005,
                                                     "tooltip": "The faces' blur, as a share of the face's height "
                                                                "(0: as sharp as the clip)."})}}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("motion_reference",)
    FUNCTION = "paint"
    CATEGORY = "Xólotl"

    def paint(self, images, masks, faces, face_blur=0.05):
        frames = images[..., :3].float().cpu().numpy()
        people = masks.float().cpu().numpy()
        if people.shape[1:] != frames.shape[1:3]:
            raise ValueError("Masks and frames differ in size.")
        if len(people) < len(frames):  # the padded tail repeats the last frame, and so does its mask
            people = np.concatenate([people, np.repeat(people[-1:], len(frames) - len(people), axis=0)])
        return (torch.from_numpy(mannequins(frames, people[:len(frames)], str(YUNET) if faces else None, face_blur)),)


class XolotlNeutralFace:
    """Puts the clip's calmest frame first, in the swap and in the clip, for LivePortrait to measure the gestures
    against (expressions.py): with the clip's own first frame, a clip that opens on a pout never passes it on.
    Both batches are cut to the clip's frames; drop the first frame of LivePortrait's result.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"swap": ("IMAGE",), "clip": ("IMAGE",),
                             "source_frames": ("INT", {"default": 120, "min": 1})}}

    RETURN_TYPES = ("IMAGE", "IMAGE", "INT")
    RETURN_NAMES = ("swap", "clip", "neutral_frame")
    FUNCTION = "pick"
    CATEGORY = "Xólotl"

    def pick(self, swap, clip, source_frames):
        import cv2

        count = min(source_frames, len(swap), len(clip))
        detector = cv2.FaceDetectorYN.create(str(YUNET), "", (320, 320), 0.6, 0.3, 50)
        index = neutral_index(clip[:count, ..., :3].float().cpu().numpy(), detector)
        logging.info("Xólotl: the clip's calmest face is frame %d of %d, LivePortrait's reference", index, count)
        return (torch.cat([swap[index:index + 1], swap[:count]]), torch.cat([clip[index:index + 1], clip[:count]]), index)


class XolotlImageDetail:
    """Lets Gemma 4 see more of a picture. ComfyUI's Generate Text gives it 280 tokens per image, about 0.65 MP
    (comfy/text_encoders/gemma4.py, max_soft_tokens), where Renata's face is 72 px wide; its vision encoder takes up to
    1120 (position_embedding_size 10240 patches, 9 per token). The CLIP comes back the same, with that budget for every
    image it reads; wire it into Generate Text in place of the loader's."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"clip": ("CLIP",),
                             "image_tokens": ("INT", {"default": 560, "min": 70, "max": 1120, "step": 70})}}

    RETURN_TYPES = ("CLIP",)
    FUNCTION = "detail"
    CATEGORY = "Xólotl"

    def detail(self, clip, image_tokens):
        sees = clip.clone()
        tokenize = sees.tokenize

        def with_budget(text, return_word_ids=False, **kwargs):
            if kwargs.get("image") is not None:
                kwargs.setdefault("max_soft_tokens", image_tokens)
            return tokenize(text, return_word_ids, **kwargs)

        sees.tokenize = with_budget
        return (sees,)


NODE_CLASS_MAPPINGS = {"XolotlFitVideo": XolotlFitVideo, "XolotlPersonBox": XolotlPersonBox,
                       "XolotlMapMasks": XolotlMapMasks, "XolotlRestoreSize": XolotlRestoreSize,
                       "XolotlGrowMasks": XolotlGrowMasks, "XolotlReuseEncodes": XolotlReuseEncodes,
                       "XolotlFaceCrop": XolotlFaceCrop, "XolotlMannequin": XolotlMannequin,
                       "XolotlNeutralFace": XolotlNeutralFace, "XolotlImageDetail": XolotlImageDetail}
NODE_DISPLAY_NAME_MAPPINGS = {"XolotlFitVideo": "Xólotl · Fit Clip on Canvas",
                              "XolotlPersonBox": "Xólotl · Frame the Person",
                              "XolotlMapMasks": "Xólotl · Masks onto the Crop",
                              "XolotlRestoreSize": "Xólotl · Restore Clip Size",
                              "XolotlGrowMasks": "Xólotl · Grow the Person's Mask",
                              "XolotlReuseEncodes": "Xólotl · Reuse VAE Encodes",
                              "XolotlFaceCrop": "Xólotl · Character Face Close-up",
                              "XolotlMannequin": "Xólotl · Grey Mannequin for the Motion",
                              "XolotlNeutralFace": "Xólotl · The Clip's Calmest Face First",
                              "XolotlImageDetail": "Xólotl · Let Gemma See More of the Picture"}
