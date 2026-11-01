"""Checks Xólotl's fit and restore nodes on CPU, inside the ComfyUI container, with the pack's own PrepareVideo.

It fits a clip, prepares it as the swap does, and restores fake swaps over a fixed ellipse mask:
  identity  the prepared frames untouched: background and colour round trip
  marker    the same with a red square in the mask: where the swap lands at full size
  shifted   the frames one step late: shows the alignment check can fail
  matrix    the untouched frames tagged with the other colour matrix: ffmpeg 7.1 negotiates colour, so the whole
            output is converted to it and differs from the original's planes everywhere (the check sees it)
Against the original clip cut the same way, it measures size, frames, sound, and PSNR and mean difference per plane
outside and inside the mask; for the identity, the shift that best aligns each plane (0, 0 = in register); for the
marker, where the square lands in each plane (its difference from the identity). Results: <out>/report-<label>.json
and frame 60 of each video as PNG.

  docker exec -w /root/ComfyUI comfyui python3.13 check-restore.py --nodes <dir with xolotl/> --pack-video \
      custom_nodes/h3_character_swap/video.py --clip clip.mp4 --start 0 --duration 5 --out <dir> --label terraza
"""
import argparse
import importlib.util
import json
import math
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, "/root/ComfyUI")
import numpy as np  # noqa: E402
import torch  # noqa: E402
import folder_paths  # noqa: E402
from comfy_api.latest._input_impl.video_types import VideoFromFile  # noqa: E402

FRAME = 60
MARGIN = 24  # px of the output kept clear of the feathered edge when measuring inside and outside


def load(path: Path, name: str):
    package = path.is_dir()
    spec = importlib.util.spec_from_file_location(name, path / "__init__.py" if package else path,
                                                  submodule_search_locations=[str(path)] if package else None)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def probe(path):
    data = json.loads(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format",
                                      "-of", "json", str(path)], check=True, capture_output=True).stdout)
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    return {"size": [video["width"], video["height"]], "frames": int(video.get("nb_read_frames", 0)),
            "seconds": round(float(data["format"]["duration"]), 3), "pix_fmt": video.get("pix_fmt"),
            "audio_seconds": round(float(audio["duration"]), 3) if audio and "duration" in audio else None,
            "color": [video.get(k) for k in ("color_space", "color_primaries", "color_transfer", "color_range")]}


def planes(args, width, height, count):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", *args, "-frames:v", str(count), "-f", "rawvideo",
                          "-pix_fmt", "yuv420p", "-"], check=True, capture_output=True).stdout
    size = width * height
    frames = np.frombuffer(raw, np.uint8).reshape(-1, size * 3 // 2)
    return (frames[:, :size].reshape(-1, height, width),
            frames[:, size:size * 5 // 4].reshape(-1, height // 2, width // 2),
            frames[:, size * 5 // 4:].reshape(-1, height // 2, width // 2))


def stats(a, b, region):
    a, b = a[:, region].astype(np.float32), b[:, region].astype(np.float32)
    mse = float(np.mean((a - b) ** 2))
    return {"psnr": round(10 * math.log10(255 ** 2 / mse), 2) if mse else None, "bias": round(float(np.mean(b - a)), 3)}


def best_shift(reference, got, region, frames=(0, 30, 60, 90)):
    """The (dx, dy) in -3..3 that best aligns got with reference inside region, with its PSNR and the PSNR at 0, 0."""
    frames = [f for f in frames if f < len(got)]
    scores = {}
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            moved = np.roll(got[frames], (dy, dx), axis=(1, 2))
            scores[(dx, dy)] = stats(reference[frames], moved, region)["psnr"] or 99.0
    (dx, dy), psnr = max(scores.items(), key=lambda item: item[1])
    return {"shift": [-dx, -dy], "psnr": psnr, "psnr_at_0": scores[(0, 0)]}


def footprint(marked, plain, scale):
    """Where the marker changed the plane at FRAME, in output pixel coordinates (pixel j spans j..j+1; a 4:2:0 chroma
    sample is taken as centred on its 2x2 block)."""
    ys, xs = np.nonzero(np.abs(marked[FRAME].astype(np.int16) - plain[FRAME].astype(np.int16)) > 8)
    if not len(xs):
        return None
    return {"center": [round(float((xs.mean() + 0.5) * scale), 1), round(float((ys.mean() + 0.5) * scale), 1)],
            "x": [int(xs.min() * scale), int((xs.max() + 1) * scale)], "y": [int(ys.min() * scale), int((ys.max() + 1) * scale)]}


def snapshot(args, png):
    subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", *args, "-vf", f"select=eq(n\\,{FRAME})",
                    "-frames:v", "1", str(png)], check=True)


def main():
    parser = argparse.ArgumentParser()
    for name in ("--nodes", "--pack-video", "--clip", "--out", "--label"):
        parser.add_argument(name, required=True)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--duration", type=float, default=5.0)
    parser.add_argument("--resolution", default="480")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    folder_paths.set_temp_directory(str(out / "temp"))
    nodes = load(Path(args.nodes) / "xolotl", "xolotl_check").nodes
    pack = load(Path(args.pack_video), "h3_video_check")
    report = {"clip": args.clip, "start": args.start, "duration": args.duration, "source": probe(args.clip)}

    clip = VideoFromFile(args.clip).as_trimmed(args.start, args.duration, strict_duration=False)
    began = time.time()
    fitted, fit = nodes.XolotlFitVideo().fit(clip, args.resolution)
    report["fit_seconds"] = round(time.time() - began, 2)
    report["fit"] = {k: v for k, v in fit.items() if k != "source"}
    began = time.time()
    prepared = pack.LabsH3PrepareVideo().prepare(fitted, args.resolution, args.duration)
    report["prepare_seconds"] = round(time.time() - began, 2)
    frames, count = prepared[0], prepared[5]
    report["prepare"] = {"size": [prepared[2], prepared[3]], "source_frames": count, "h3_length": prepared[4]}
    if [prepared[2], prepared[3]] != fit["canvas"]:
        raise SystemExit(f"PrepareVideo changed the canvas: {prepared[2]}x{prepared[3]} vs {fit['canvas']}")

    (canvas_w, canvas_h), (bx, by, bw, bh) = fit["canvas"], fit["box"]
    width, height = fit["width"], fit["height"]
    cx, cy, rx, ry = bx + bw * 0.5, by + bh * 0.55, bw * 0.22, bh * 0.40
    yy, xx = torch.meshgrid(torch.arange(canvas_h), torch.arange(canvas_w), indexing="ij")
    ellipse = ((((xx + 0.5 - cx) / rx) ** 2 + ((yy + 0.5 - cy) / ry) ** 2) <= 1).float()
    masks = ellipse.expand(prepared[4], -1, -1)  # as long as the pack's H3 window, like Expand Mask's
    frames = frames[:count]
    marked = frames.clone()
    marked[:, round(cy) - 16:round(cy) + 16, round(cx) - 16:round(cx) + 16] = torch.tensor([1.0, 0.0, 0.0])
    shifted = torch.cat([frames[:1], frames[:-1]])
    other = "smpte170m" if fit["color"].get("color_space") == "bt709" else "bt709"
    cases = {"identity": (frames, fit), "marker": (marked, fit), "shifted": (shifted, fit),
             "matrix": (frames, {**fit, "color": {**fit["color"], "color_space": other}})}

    # Full-size regions: the ellipse scaled back, MARGIN px clear of its feathered edge.
    sx, sy = width / bw, height / bh
    ecx, ecy, erx, ery = (cx - bx) * sx, (cy - by) * sy, rx * sx, ry * sy
    gy, gx = np.mgrid[0:height, 0:width] + 0.5
    radius = lambda grow: ((gx - ecx) / (erx + grow)) ** 2 + ((gy - ecy) / (ery + grow)) ** 2
    inside, outside = radius(-MARGIN) <= 1, radius(MARGIN) >= 1
    original_args = [*nodes._input(fit), "-vf", nodes.TIMELINE]
    reference = planes(original_args, width, height, count)
    snapshot(original_args, out / f"{args.label}-original.png")
    for name, (images, case_fit) in cases.items():
        began = time.time()
        video = nodes.XolotlRestoreSize().restore(images, masks, case_fit, 6.0)[0]
        seconds = round(time.time() - began, 2)
        path = Path(video.get_stream_source())
        result = {"restore_seconds": seconds, **probe(path)}
        got = planes(["-i", str(path)], width, height, count)
        for label, region in (("outside", outside), ("inside", inside)):
            result[label] = {plane: stats(ref, new, region if plane == "Y" else region[::2, ::2])
                             for plane, ref, new in zip("YUV", reference, got)}
        if name == "identity":
            identity = got
            result["register"] = {plane: best_shift(ref, new, inside if plane == "Y" else inside[::2, ::2])
                                  for plane, ref, new in zip("YUV", reference, got)}
        if name == "marker":
            mx, my = (round(cx) - bx) * sx, (round(cy) - by) * sy  # the painted square's centre, at full size
            result["marker"] = {"expected": {"center": [round(mx, 1), round(my, 1)],
                                             "x": [round(mx - 16 * sx), round(mx + 16 * sx)],
                                             "y": [round(my - 16 * sy), round(my + 16 * sy)]},
                                **{plane: footprint(new, old, 1 if plane == "Y" else 2)
                                   for plane, new, old in zip("YUV", got, identity)}}
        target = out / f"{args.label}-{name}.mp4"
        path.replace(target)
        snapshot(["-i", str(target)], out / f"{args.label}-{name}.png")
        report[name] = result
    (out / f"report-{args.label}.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
