#!/usr/bin/env bash
# Both measures of a take, inside the ComfyUI container (OpenCV, insightface and buffalo_l live there):
# whose face it shows (identity-follow.py) and how closely its mouth follows the clip (mouth-follow.py).
#   scripts/measure-take.sh <take.mp4> <clip.mp4> <character face image> [frames=124] [container=comfyui]
# Copies the four files and both scripts into input/xolotl-medidas/ of the container and prints the results.
set -euo pipefail
take=$1 clip=$2 face=$3 frames=${4:-124} box=${5:-comfyui}
here=$(cd "$(dirname "$0")" && pwd)
dir=/root/ComfyUI/input/xolotl-medidas
docker exec "$box" mkdir -p "$dir"
for f in "$take" "$clip" "$face" "$here/identity-follow.py" "$here/mouth-follow.py"; do docker cp -q "$f" "$box:$dir/"; done
yunet=$dir/face_detection_yunet_2023mar.onnx
docker exec "$box" test -f "$yunet" || { echo "missing $yunet (OpenCV Zoo YuNet, MIT): copy it there first" >&2; exit 1; }
t=$(basename "$take") c=$(basename "$clip") a=$(basename "$face")
docker exec -w "$dir" -e FRAMES="$frames" "$box" python3.13 mouth-follow.py face_detection_yunet_2023mar.onnx "$c" "$t" 2>&1 \
  | grep -v -E 'WARN|^\[' | sed -n '2p'
docker exec -w "$dir" "$box" python3.13 identity-follow.py /root/ComfyUI/models/insightface "$c" "$t=$a" 2>&1 \
  | grep -E 'like the character|no face'
