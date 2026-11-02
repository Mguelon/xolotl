#!/usr/bin/env bash
# Installs the node packs Xólotl's workflow uses into your ComfyUI, at the revisions Xólotl was tested with:
#   - Xólotl's own seven nodes (comfy_nodes/xolotl in this repo): the clip on the model's canvas, the crop around the
#     person, the first pass's masks carried onto that crop, the person's mask grown, the VAE without the pack's
#     repeated encode, the result back at the clip's own size and place, and the close-up of the character's face
#     (OpenCV's YuNet, MIT, bundled in models/). Plain Python, OpenCV and ffmpeg, which ComfyUI needs anyway.
#   - Akatz Labs' h3_character_swap (GPL-3.0): detection, tracking, masked regeneration and assembly.
#   - Veda (MIT), learned sparse attention for H3: optional; without it a take runs full attention, about 11 % slower
#     at 480p on an RTX A4000. It needs Triton, which ships with PyTorch on Linux (triton-windows on Windows).
# The swap pack's Python deps (numpy, scipy, Pillow, opencv-python-headless) ship with most ComfyUI installs;
# otherwise: pip install -r custom_nodes/h3_character_swap/requirements.txt
#   usage: scripts/install-nodes.sh /path/to/ComfyUI
set -euo pipefail
COMFYUI_DIR="${1:-${COMFYUI_DIR:-}}"
[ -n "$COMFYUI_DIR" ] || { echo "usage: $0 /path/to/ComfyUI  (or set COMFYUI_DIR)"; exit 1; }
[ -d "$COMFYUI_DIR/custom_nodes" ] || { echo "$COMFYUI_DIR/custom_nodes not found"; exit 1; }
HERE="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$COMFYUI_DIR/custom_nodes/xolotl"
mkdir -p "$COMFYUI_DIR/custom_nodes/xolotl"
cp "$HERE/comfy_nodes/xolotl/__init__.py" "$HERE/comfy_nodes/xolotl/nodes.py" "$HERE/comfy_nodes/xolotl/geometry.py" \
  "$HERE/comfy_nodes/xolotl/reuse.py" "$HERE/comfy_nodes/xolotl/masks.py" \
  "$COMFYUI_DIR/custom_nodes/xolotl/"
cp -R "$HERE/comfy_nodes/xolotl/models" "$COMFYUI_DIR/custom_nodes/xolotl/"
REV=0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b
TMP=$(mktemp -d)
git clone -q --filter=blob:none --no-checkout https://github.com/akatz-labs/h3-character-swap-tool.git "$TMP/src"
git -C "$TMP/src" sparse-checkout set worker_nodes/h3_character_swap
git -C "$TMP/src" checkout -q "$REV"
rm -rf "$COMFYUI_DIR/custom_nodes/h3_character_swap"
cp -R "$TMP/src/worker_nodes/h3_character_swap" "$COMFYUI_DIR/custom_nodes/"
rm -rf "$TMP"
VEDA=67e4eb5541b648555563144401ebaba832bd73ec
rm -rf "$COMFYUI_DIR/custom_nodes/Veda-on-ComfyUI"
git clone -q https://github.com/veda-sparse/Veda-on-ComfyUI.git "$COMFYUI_DIR/custom_nodes/Veda-on-ComfyUI"
git -C "$COMFYUI_DIR/custom_nodes/Veda-on-ComfyUI" checkout -q "$VEDA"
echo "installed custom_nodes/xolotl, custom_nodes/h3_character_swap @ ${REV:0:7} and custom_nodes/Veda-on-ComfyUI @ ${VEDA:0:7} — restart ComfyUI, then: npm run doctor"
