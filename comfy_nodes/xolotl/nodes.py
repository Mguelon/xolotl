"""Xólotl's two video nodes around the Akatz H3 character-swap pack.

XolotlFitVideo puts the whole clip, or a crop of it, on the model's canvas (contain and pad, never cut), so H3
Prepare Video keeps it as it is. XolotlPersonBox turns the masks of a first pass over the whole frame into that crop:
the person with some room, so the canvas's pixels go to them instead of the scenery. XolotlRestoreSize lays the swap
back over the clip's own frames, at the clip's own size and place, through the region the swap regenerated:
everything outside it stays the original footage until the final encode.

Both nodes cut and decode the original file with the same ffmpeg options, so they see the same frames, and neither
goes through the H.264 copy ComfyUI makes of a sliced clip. ffmpeg does the pixel work, as in the pack, so a long
1080p clip never sits in memory as float tensors.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
import uuid
from fractions import Fraction
from pathlib import Path

import folder_paths
import torch
from comfy_api.latest._input_impl.video_types import VideoFromFile

from .geometry import PIXEL_BUDGETS, fit_canvas, person_box

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


NODE_CLASS_MAPPINGS = {"XolotlFitVideo": XolotlFitVideo, "XolotlPersonBox": XolotlPersonBox,
                       "XolotlRestoreSize": XolotlRestoreSize}
NODE_DISPLAY_NAME_MAPPINGS = {"XolotlFitVideo": "Xólotl · Fit Clip on Canvas",
                              "XolotlPersonBox": "Xólotl · Frame the Person",
                              "XolotlRestoreSize": "Xólotl · Restore Clip Size"}
