"""How closely a take's mouth follows the clip's: per frame, the mouth's width (YuNet's two mouth corners) over the
distance between the eyes, so the size of the face does not count; pursed lips make it narrower. Prints, per take, the
correlation of that series with the clip's over the frames where both faces were found, and the series' spread; and how
far apart the eyes are (median and the 10th percentile, in the file's pixels), to tell how small the face is drawn.
  [FRAMES=312] python3 scripts/mouth-follow.py face_detection_yunet_2023mar.onnx clip.mp4 take1.mp4 [take2.mp4 ...]   (OpenCV with FaceDetectorYN, numpy, ffmpeg)"""
import subprocess, sys
import os
import cv2, numpy as np

N = int(os.environ.get("FRAMES", 124))  # the frames each series reads: by default the first window of a take

def frames(path, n=N):
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout.strip().split(",")
    w, h = int(probe[0]), int(probe[1])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-frames:v", str(n), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3), w, h

def mouth_series(model, path):
    video, w, h = frames(path)
    det = cv2.FaceDetectorYN.create(model, "", (w, h), 0.6, 0.3, 50)
    out, apart = [], []
    for f in video:
        _, faces = det.detect(np.ascontiguousarray(f))
        if faces is None:
            out.append(np.nan); apart.append(np.nan); continue
        face = faces[np.argmax(faces[:, 2] * faces[:, 3])]
        eyes = np.hypot(face[4] - face[6], face[5] - face[7])
        mouth = np.hypot(face[10] - face[12], face[11] - face[13])
        out.append(mouth / eyes); apart.append(eyes)
    mouth_series.apart = np.array(apart)
    return np.array(out)


def apart_text():
    a = mouth_series.apart
    return f"eyes {np.nanmedian(a):.0f} px apart (10th percentile {np.nanpercentile(a, 10):.0f})"

model, clip, *takes = sys.argv[1:]
ref = mouth_series(model, clip)
print(f"clip: mouth/eyes {np.nanmin(ref):.2f}-{np.nanmax(ref):.2f}, spread {np.nanstd(ref):.3f}, {apart_text()}")
for take in takes:
    s = mouth_series(model, take)
    n = min(len(ref), len(s)); s = s[:n]; r0 = ref[:n]
    both = ~np.isnan(r0) & ~np.isnan(s)
    r = np.corrcoef(r0[both], s[both])[0, 1]
    print(f"{take.rsplit('/', 1)[-1]}: correlation with the clip {r:+.2f} over {both.sum()} frames, spread {np.nanstd(s):.3f}, "
          f"{apart_text()}")
