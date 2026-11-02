"""Whose face a take shows: every 12th frame, the cosine similarity of the take's face (insightface buffalo_l, the
largest face) to the character's reference and to the clip's face in the same frame. A swap that worked is close to the
character and far from the clip. Prints the medians and, per take, the share of frames closer to the clip; PER_FRAME=1 also prints each sampled frame
(its number, seconds, and both similarities), to see where a take loses the character, and WINDOW=3.5-6.5 counts those
frames inside a stretch of the clip too (the turn of the 13 s test clip).
  python3 scripts/identity-follow.py <insightface root> clip.mp4 take1.mp4=character1.png [take2.mp4=character2.png ...]
(insightface with buffalo_l under <root>/models, OpenCV, numpy, ffmpeg)"""
import os
import subprocess
import sys

import cv2
import numpy as np
from insightface.app import FaceAnalysis

EVERY = 12


def frames(path):
    w, h = map(int, subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                    "stream=width,height", "-of", "csv=p=0", path],
                                   capture_output=True, text=True, check=True).stdout.strip().split(","))
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"select=not(mod(n\\,{EVERY}))", "-fps_mode",
                          "passthrough", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)


def embedding(app, image):
    faces = app.get(np.ascontiguousarray(image))
    if not faces:
        return None
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])).normed_embedding


root, clip, *pairs = sys.argv[1:]
app = FaceAnalysis(name="buffalo_l", root=root, providers=["CPUExecutionProvider"])
app.prepare(ctx_id=-1, det_size=(640, 640))
clip_faces = [embedding(app, f) for f in frames(clip)]
for pair in pairs:
    take, character = pair.split("=")
    ref = embedding(app, cv2.imread(character))
    if ref is None:
        print(f"{take}: no face in {character}"); continue
    to_char, to_clip, seconds = [], [], []
    for i, (f, c) in enumerate(zip(frames(take), clip_faces)):
        e = embedding(app, f)
        if e is None or c is None:
            continue
        to_char.append(float(e @ ref)); to_clip.append(float(e @ c)); seconds.append(i * EVERY / 24)
        if os.environ.get("PER_FRAME"):
            print(f"  frame {i * EVERY:4d} ({i * EVERY / 24:5.2f} s): like the character {to_char[-1]:.2f}, "
                  f"like the clip {to_clip[-1]:.2f}{'  <- the clip' if to_clip[-1] > to_char[-1] else ''}")
    a, b = np.array(to_char), np.array(to_clip)
    print(f"{take.rsplit('/', 1)[-1]}: like the character {np.median(a):.2f}, like the clip {np.median(b):.2f}, "
          f"closer to the clip in {np.mean(b > a):.0%} of {len(a)} frames ({int(np.sum(b > a))})")
    if os.environ.get("WINDOW"):
        lo, hi = (float(x) for x in os.environ["WINDOW"].split("-"))
        inside = (np.array(seconds) >= lo) & (np.array(seconds) <= hi)
        print(f"  {lo:g}-{hi:g} s: closer to the clip in {int(np.sum((b > a) & inside))} of {int(np.sum(inside))} frames")
