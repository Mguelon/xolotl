#!/usr/bin/env bash
# Installs Akatz Labs' h3_character_swap node pack (GPL-3.0) into your ComfyUI, at the revision Xólotl was tested with.
# Its Python deps (numpy, scipy, Pillow, opencv-python-headless) ship with most ComfyUI installs;
# otherwise: pip install -r custom_nodes/h3_character_swap/requirements.txt
#   usage: scripts/install-nodes.sh /path/to/ComfyUI
set -euo pipefail
COMFYUI_DIR="${1:-${COMFYUI_DIR:-}}"
[ -n "$COMFYUI_DIR" ] || { echo "usage: $0 /path/to/ComfyUI  (or set COMFYUI_DIR)"; exit 1; }
[ -d "$COMFYUI_DIR/custom_nodes" ] || { echo "$COMFYUI_DIR/custom_nodes not found"; exit 1; }
REV=0670e4fdf95adf2262caa4b81afed2a9c4ae4b7b
TMP=$(mktemp -d)
git clone -q --filter=blob:none --no-checkout https://github.com/akatz-labs/h3-character-swap-tool.git "$TMP/src"
git -C "$TMP/src" sparse-checkout set worker_nodes/h3_character_swap
git -C "$TMP/src" checkout -q "$REV"
rm -rf "$COMFYUI_DIR/custom_nodes/h3_character_swap"
cp -R "$TMP/src/worker_nodes/h3_character_swap" "$COMFYUI_DIR/custom_nodes/"
rm -rf "$TMP"
echo "installed custom_nodes/h3_character_swap @ ${REV:0:7} — restart ComfyUI, then: npm run doctor"
