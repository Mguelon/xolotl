#!/usr/bin/env bash
# Downloads the open-weights models Xólotl's workflow loads, into your ComfyUI models/ folder.
# Revisions are pinned to what Xólotl was tested with. Read each model card's licence before use
# (MiniMax H3 and the swap LoRA: MiniMax H3 Community License; SAM 3.1: its own licence).
#   usage: scripts/install-models.sh /path/to/ComfyUI [--int8] [--singularity]
#   --int8        also fetch the int8 "convrot" H3 (needs the CUDA 13 kernels; faster on supported GPUs)
#   --singularity also fetch the Singularity v1.3 w4a8 H3 merge (11.8 GB, fits a 16 GB GPU whole)
set -euo pipefail
COMFYUI_DIR="${1:-${COMFYUI_DIR:-}}"; shift || true
[ -n "$COMFYUI_DIR" ] || { echo "usage: $0 /path/to/ComfyUI [--int8] [--singularity]"; exit 1; }
command -v hf >/dev/null || { echo "install the Hugging Face CLI first: python3 -m pip install -U huggingface_hub"; exit 1; }
M="$COMFYUI_DIR/models"
get() { hf download "$1" "$2" --revision "$3" --local-dir "$4"; }
H3=912b6e38b2092ec4d2e86d24183e0d59ea059d48
get Comfy-Org/MiniMax-H3 diffusion_models/minimax_h3_ref2va_pruned_fp8_scaled.safetensors $H3 "$M"   # 21 GB
get Comfy-Org/MiniMax-H3 text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors   $H3 "$M"   # 15.7 GB
get Comfy-Org/MiniMax-H3 vae/minimax_h3_video_vae_fp16.safetensors                    $H3 "$M"   # 5.2 GB
get Comfy-Org/MiniMax-H3 vae/minimax_h3_audio_vae_fp32.safetensors                    $H3 "$M"   # 0.6 GB
get Comfy-Org/sam3.1 checkpoints/sam3.1_multiplex_fp16.safetensors 7bb8374780a725b4353ed31f3a9395c9742b5621 "$M"   # 1.75 GB
get akatz-ai/MiniMax-H3-Character-Swap-LoRA h3_character_swap_v1.5.safetensors 96ea3407b230b6f7df71c58c70e31df96bd7e533 "$M/loras"   # 0.16 GB
get lightx2v/Minimax-h3-Turbo minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors 30f485ed874aa44c8183348ad361c5eabad318da "$M/loras"   # 1.96 GB
for flag in "$@"; do case "$flag" in
  --int8) get Comfy-Org/MiniMax-H3 diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors $H3 "$M" ;;   # 21 GB
  --singularity) get WarmBloodAban/Minimax-h3_Singularity Minimax-h3_Singularity_ref2va_v1.3_Pruned_w4a8.safetensors 1259cf16cd0b655ba691a32fb46a409142762972 "$M/diffusion_models" ;;   # 11.8 GB
  *) echo "unknown flag $flag"; exit 1 ;;
esac; done
echo "models are in $M — restart ComfyUI if it was running, then: npm run doctor"
