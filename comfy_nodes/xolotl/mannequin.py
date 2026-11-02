"""The person in H3's motion reference as a grey figure, so H3 takes the motion from the clip and not the person's
looks: the clothes' colours and cut, the hair's colour and the face's skin go grey and soft, and the shading stays,
so the pose, the arms and the hands read as before. The face keeps finer detail from the green channel (lips darker
than skin).

The idea and its numbers are D3voz's H3GreyMannequins (comfyui-h3-oneclick-swap, MIT): grey = 0.45 + 0.45 * luma,
the body's luma blurred with sigma 8 px on the canvas, the face's green channel with 5 % of the face's height.
The body's blur runs at half size (a blur that wide loses nothing there), YuNet looks for faces at half size, and
only the person's box is painted, the faces' detail only around each face, each thread straight into the result.
numpy and OpenCV only, both of which ComfyUI ships, so it is tested without ComfyUI."""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

BODY_SIGMA = 8.0   # px on the canvas: the soft blur of a person who fills the frame's height
FACE_SIGMA = 0.05  # of the face's height
FACE_GROW = 1.25   # the face ellipse's axes, in halves of YuNet's box: the box runs from the brows to the chin
LUMA = np.array([0.299, 0.587, 0.114], np.float32)
WORKERS = 16  # 313 frames at 512×928 (13 s at 480p): 4.3 s; 5.5 s with 8; 46 s single-threaded at full size


def _half(image: np.ndarray) -> np.ndarray:
    return cv2.resize(image, (max(1, image.shape[1] // 2), max(1, image.shape[0] // 2)), interpolation=cv2.INTER_AREA)


def face_boxes(frame: np.ndarray, detector) -> np.ndarray:
    """YuNet's face boxes [n, 4] (x, y, w, h) in an RGB float frame's pixels (0..1), looked for at half size."""
    small = np.ascontiguousarray((_half(frame)[:, :, ::-1] * 255).round().astype(np.uint8))  # YuNet reads BGR uint8
    detector.setInputSize((small.shape[1], small.shape[0]))
    _, faces = detector.detect(small)
    return np.zeros((0, 4), np.float32) if faces is None else faces[:, :4] * 2


def face_regions(shape: tuple[int, int], boxes: np.ndarray):
    """Per face box: its region (y0, y1, x0, x1) and a soft ellipse (0..1) over the face inside it."""
    h, w = shape
    for x, y, fw, fh in boxes:
        centre = (int(round(x + fw / 2)), int(round(y + fh / 2)))
        axes = (max(1, int(round(fw / 2 * FACE_GROW))), max(1, int(round(fh / 2 * FACE_GROW))))
        sigma = max(1.0, 0.1 * fh)
        pad = int(3 * sigma) + 1
        x0, y0 = max(0, centre[0] - axes[0] - pad), max(0, centre[1] - axes[1] - pad)
        x1, y1 = min(w, centre[0] + axes[0] + pad + 1), min(h, centre[1] + axes[1] + pad + 1)
        if x1 <= x0 or y1 <= y0:
            continue
        weights = np.zeros((y1 - y0, x1 - x0), np.float32)
        cv2.ellipse(weights, (centre[0] - x0, centre[1] - y0), axes, 0, 0, 360, 1.0, -1)
        yield (y0, y1, x0, x1), cv2.GaussianBlur(weights, (0, 0), sigma), float(fh)


def paint(frame: np.ndarray, person: np.ndarray, boxes: np.ndarray | None = None,
          face_blur: float = FACE_SIGMA, out: np.ndarray | None = None) -> np.ndarray:
    """One RGB float frame (0..1) with the person (a 0..1 mask) turned grey; the faces in `boxes` keep finer detail,
    blurred by `face_blur` of the face's height (0: as sharp as the frame). Written into `out` when given."""
    if out is None:
        out = frame.copy()
    else:
        out[...] = frame
    ys, xs = np.nonzero(person > 0)
    if not len(ys):
        return out
    h, w = person.shape
    pad = int(3 * BODY_SIGMA) + 2  # the blur reads this far outside the person
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad + 1)
    f = frame[y0:y1, x0:x1]
    luma = _half(np.ascontiguousarray(f @ LUMA))
    luma = cv2.resize(cv2.GaussianBlur(luma, (0, 0), BODY_SIGMA / 2), (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
    if boxes is not None and len(boxes):
        for (fy0, fy1, fx0, fx1), weights, height in face_regions((h, w), boxes):
            # the face's region within the person's box (a face cut by the box keeps only its inside part)
            ry0, ry1, rx0, rx1 = max(fy0, y0), min(fy1, y1), max(fx0, x0), min(fx1, x1)
            if ry1 <= ry0 or rx1 <= rx0:
                continue
            detail = np.ascontiguousarray(frame[ry0:ry1, rx0:rx1, 1])
            if face_blur > 0:
                detail = cv2.GaussianBlur(detail, (0, 0), max(0.5, face_blur * height))
            part = luma[ry0 - y0:ry1 - y0, rx0 - x0:rx1 - x0]
            part += (detail - part) * weights[ry0 - fy0:ry1 - fy0, rx0 - fx0:rx1 - fx0]
    m = person[y0:y1, x0:x1, None]
    out[y0:y1, x0:x1] = f + ((0.45 + 0.45 * luma)[:, :, None] - f) * m
    return out


def mannequins(frames: np.ndarray, masks: np.ndarray, face_model: str | None = None, face_blur: float = FACE_SIGMA,
               workers: int = WORKERS) -> np.ndarray:
    """[N, H, W, 3] RGB float32 frames and [N, H, W] person masks (0..1) -> the frames with the person grey. With
    YuNet's model the faces keep their finer detail; without it, the whole person gets the body's blur."""
    local = threading.local()
    result = np.empty_like(frames)

    def one(i):
        boxes = None
        if face_model:
            if not hasattr(local, "detector"):  # one detector per thread: YuNet keeps state per call
                local.detector = cv2.FaceDetectorYN.create(face_model, "", (320, 320), 0.6, 0.3, 50)
            boxes = face_boxes(frames[i], local.detector)
        paint(frames[i], masks[i], boxes, face_blur, result[i])

    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(one, range(len(frames))))
    return result
