"""The character's face close-up outside ComfyUI, with the same detector and square as the XolotlFaceCrop node
(comfy_nodes/xolotl: geometry.face_square, the YuNet model bundled in models/). For measurements and checks.
  python3 scripts/face-crop.py character.png out.png [--size 800]
(OpenCV with FaceDetectorYN, numpy)"""
import argparse
import importlib.util
from pathlib import Path

import cv2
import numpy as np

PACK = Path(__file__).resolve().parent.parent / "comfy_nodes" / "xolotl"
spec = importlib.util.spec_from_file_location("geometry", PACK / "geometry.py")
geometry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geometry)


def crop(image: np.ndarray, size: int) -> np.ndarray:
    h, w = image.shape[:2]
    det = cv2.FaceDetectorYN.create(str(PACK / "models" / "face_detection_yunet_2023mar.onnx"), "", (w, h), 0.6, 0.3, 50)
    _, faces = det.detect(image)
    if faces is None:
        raise SystemExit("no face in the character image")
    x0, y0, side = geometry.face_square(faces[np.argmax(faces[:, 2] * faces[:, 3])][:4], w, h)
    method = cv2.INTER_LANCZOS4 if side < size else cv2.INTER_AREA
    return cv2.resize(image[y0:y0 + side, x0:x0 + side], (size, size), interpolation=method)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("image"); ap.add_argument("out")
    ap.add_argument("--size", type=int, default=800)
    a = ap.parse_args()
    out = crop(cv2.imread(a.image), a.size)
    cv2.imwrite(a.out, out)
    print(f"{a.out}: {out.shape[1]}x{out.shape[0]}")
