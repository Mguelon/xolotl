"""Checks a take that came back at the clip's own size against the clip, and against a take of the same clip,
character and seed that went the pack's own way (cropped to its canvas and returned at that size).

  python3 -I scripts/check-take.py --result take.mp4 --clip clip.mp4 --start 0 --seconds 5.1 \
      [--canvas-take earlier.mp4] --out <dir>

Reports, in <out>/check-take.json:
  output     size, frames, seconds and sound of the result; frames of the clip's cut, made as the nodes make it
             (H3 Prepare Video then keeps floor(seconds x 24) of them)
  background PSNR and mean difference per plane where the swap changed nothing: pixels more than 48 px from any
             pixel whose luma moved by more than 20 levels in some frame; and the share of the frame that is
  sharpness  mean luma gradient of that background in the result over the clip's (1.0 = as sharp as the clip)
  jacket     mean Cb/Cr in the region the recipe bake-off measured (180x80 at 150,240 of the 928x512 canvas,
             frames 20-100), with the result brought to that canvas the way the pack crops, and on the canvas take
  detail     fine detail on the person: mean absolute 4-neighbour Laplacian of luma where the result moved (the
             person and the band around them), in the clip, in the result and, with --canvas-take, in the canvas take
             brought back to the clip's size (lanczos) where its canvas covers the clip
"""
import argparse
import json
import math
import subprocess
from pathlib import Path

import numpy as np

TIMELINE = "setpts=PTS-STARTPTS,fps=fps=24:round=near:eof_action=round"  # as the pack and Xólotl's nodes
CANVAS = "scale=w='ceil(max(928,512*dar)-1e-6)':h='ceil(max(512,928/dar)-1e-6)':flags=lanczos,setsar=1,crop=928:512"
JACKET = "select='between(n\\,20\\,100)',crop=180:80:150:240,signalstats,metadata=print:file=-"


def probe(path, args=()):
    data = json.loads(subprocess.run(["ffprobe", "-v", "error", *args, "-count_frames", "-show_streams",
                                      "-show_format", "-of", "json", str(path)], check=True, capture_output=True).stdout)
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    return {"size": [video["width"], video["height"]], "frames": int(video.get("nb_read_frames", 0)),
            "seconds": round(float(data["format"]["duration"]), 3),
            "audio_seconds": round(float(audio["duration"]), 3) if audio and "duration" in audio else None}


def planes(args, width, height, count):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", *args, "-frames:v", str(count), "-f", "rawvideo",
                          "-pix_fmt", "yuv420p", "-"], check=True, capture_output=True).stdout
    size = width * height
    frames = np.frombuffer(raw, np.uint8).reshape(-1, size * 3 // 2)
    return (frames[:, :size].reshape(-1, height, width),
            frames[:, size:size * 5 // 4].reshape(-1, height // 2, width // 2),
            frames[:, size * 5 // 4:].reshape(-1, height // 2, width // 2))


def dilate(region, radius):
    """True wherever a True pixel lies within the (2r+1)^2 box around it (integral image)."""
    padded = np.pad(region.astype(np.int32), radius + 1)
    total = padded.cumsum(0).cumsum(1)
    k = 2 * radius + 1
    box = total[k:, k:] - total[:-k, k:] - total[k:, :-k] + total[:-k, :-k]
    return box[:region.shape[0], :region.shape[1]] > 0


def stats(a, b, region):
    a, b = a[:, region].astype(np.float32), b[:, region].astype(np.float32)
    mse = float(np.mean((a - b) ** 2))
    return {"psnr": round(10 * math.log10(255 ** 2 / mse), 2) if mse else None, "bias": round(float(np.mean(b - a)), 3)}


def gradient(y, region):
    y = y.astype(np.float32)
    g = np.abs(np.diff(y, axis=2))[:, :-1, :] + np.abs(np.diff(y, axis=1))[:, :, :-1]
    return float(g[:, region[:-1, :-1]].mean())


def laplacian(y, region):
    """Mean absolute 4-neighbour Laplacian of luma inside region, 16 frames at a time: the fine detail there."""
    inner = region[1:-1, 1:-1]
    total = 0.0
    for i in range(0, len(y), 16):
        v = y[i:i + 16].astype(np.float32)
        lap = np.abs(4 * v[:, 1:-1, 1:-1] - v[:, :-2, 1:-1] - v[:, 2:, 1:-1] - v[:, 1:-1, :-2] - v[:, 1:-1, 2:])
        total += float(lap[:, inner].sum())
    return round(total / (len(y) * int(inner.sum())), 2)


def uncanvas(width, height):
    """The filter that brings a 928x512 canvas take back to the clip's size, and the part of the clip it covers."""
    scale = max(928 / width, 512 / height)  # CANVAS covers the canvas, then centre-crops
    left = (math.ceil(width * scale - 1e-6) - 928) // 2 / scale
    top = (math.ceil(height * scale - 1e-6) - 512) // 2 / scale
    even = lambda v: int(round(v / 2)) * 2
    w, h, x, y = even(928 / scale), even(512 / scale), even(left), even(top)
    covered = np.zeros((height, width), bool)
    covered[y + 4:min(height, y + h) - 4, x + 4:min(width, x + w) - 4] = True  # lanczos rings at the edges
    return f"scale={w}:{h}:flags=lanczos,pad={max(width, x + w)}:{max(height, y + h)}:{x}:{y},crop={width}:{height}:0:0", covered


def jacket(path, canvas_filter):
    out = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-vf",
                          (canvas_filter + "," if canvas_filter else "") + JACKET, "-f", "null", "-"],
                         check=True, capture_output=True, text=True).stdout
    u = [float(l.split("=")[1]) for l in out.splitlines() if "UAVG" in l]
    v = [float(l.split("=")[1]) for l in out.splitlines() if "VAVG" in l]
    return {"Cb": round(sum(u) / len(u), 2), "Cr": round(sum(v) / len(v), 2), "frames": len(u)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", required=True)
    parser.add_argument("--clip", required=True)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--seconds", type=float, required=True)
    parser.add_argument("--canvas-take")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    cut = (["-ss", f"{args.start:.6f}"] if args.start else []) + ["-t", f"{args.seconds:.6f}", "-i", args.clip]
    report = {"result": probe(args.result)}
    width, height = report["result"]["size"]
    count = report["result"]["frames"]
    clip = planes([*cut, "-vf", TIMELINE], width, height, count + 8)  # the cut as the nodes make it, a few extra
    report["clip_cut"] = {"frames": len(clip[0])}
    clip = tuple(plane[:count] for plane in clip)
    take = planes(["-i", args.result], width, height, count)
    moved = (np.abs(take[0].astype(np.int16) - clip[0].astype(np.int16)) > 20).any(axis=0)
    background = ~dilate(moved, 48)
    report["background"] = {"share": round(float(background.mean()), 3),
                            **{plane: stats(a, b, background if plane == "Y" else background[::2, ::2])
                               for plane, a, b in zip("YUV", clip, take)}}
    report["sharpness"] = round(gradient(take[0], background) / gradient(clip[0], background), 3)
    report["jacket"] = {"result": jacket(args.result, CANVAS)}
    report["detail"] = {"region_share": round(float(moved.mean()), 3)}
    if args.canvas_take:
        report["canvas_take"] = probe(args.canvas_take)
        report["jacket"]["canvas_take"] = jacket(args.canvas_take, "")
        back, covered = uncanvas(width, height)
        moved &= covered
        report["detail"]["canvas_take"] = laplacian(planes(["-i", args.canvas_take, "-vf", back], width, height,
                                                           count)[0], moved)
    report["detail"].update(clip=laplacian(clip[0], moved), result=laplacian(take[0], moved))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "check-take.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
