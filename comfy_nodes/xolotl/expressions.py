"""The clip's most neutral face, the reference LivePortrait measures the gestures against.

LivePortrait's relative motion copies each frame's expression as a change from one reference frame of the driving
clip. Its first frame is the default, and a clip that opens on a pout makes the pout the face at rest: the character
then never pouts (Renata, 13 s: no pout with the first frame, the pouts back with a calm frame of the same clip).
YuNet's five points give each face its mouth width over its eye distance; among the faces that look at the camera,
the frame whose ratio is the median one is the calm one (neither a pout, which narrows the mouth, nor a smile).
numpy and OpenCV only, so it is tested without ComfyUI."""
from __future__ import annotations

import cv2
import numpy as np

FRONTAL = 0.12  # the nose's distance from the eyes' middle, in eye distances, for a face that looks at the camera
LEVEL = 0.15    # the eyes' height difference, in eye distances: a head that is not tilted


def face_points(frame: np.ndarray, detector) -> np.ndarray | None:
    """YuNet's largest face in an RGB float frame (0..1), looked for at half size: [x, y, w, h, 10 landmark values,
    score] in the frame's pixels, or None."""
    h, w = frame.shape[:2]
    small = cv2.resize(frame, (max(1, w // 2), max(1, h // 2)), interpolation=cv2.INTER_AREA)
    small = np.ascontiguousarray((small[:, :, ::-1] * 255).round().astype(np.uint8))
    detector.setInputSize((small.shape[1], small.shape[0]))
    _, faces = detector.detect(small)
    if faces is None:
        return None
    face = faces[np.argmax(faces[:, 2] * faces[:, 3])].copy()
    face[:14] *= 2
    return face


def calm_ratio(face: np.ndarray) -> float | None:
    """Mouth width over eye distance for a face that looks at the camera, else None."""
    right_eye, left_eye, nose = face[4:6], face[6:8], face[8:10]
    mouth_right, mouth_left = face[10:12], face[12:14]
    eyes = float(np.linalg.norm(left_eye - right_eye))
    if eyes < 1:
        return None
    if abs(nose[0] - (right_eye[0] + left_eye[0]) / 2) / eyes > FRONTAL or abs(right_eye[1] - left_eye[1]) / eyes > LEVEL:
        return None
    return float(np.linalg.norm(mouth_left - mouth_right)) / eyes


def neutral_index(frames: np.ndarray, detector, every: int = 2) -> int:
    """The frame (of every `every`-th) whose frontal face has the median mouth ratio; 0 when no face qualifies."""
    found = []
    for i in range(0, len(frames), every):
        face = face_points(frames[i], detector)
        ratio = None if face is None else calm_ratio(face)
        if ratio is not None:
            found.append((i, ratio))
    if not found:
        return 0
    median = float(np.median([r for _, r in found]))
    return min(found, key=lambda item: (abs(item[1] - median), item[0]))[0]
