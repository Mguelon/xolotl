#!/usr/bin/env bash
# Downloads the open-weights models Xólotl's workflow loads, into your ComfyUI models/ folder.
# Revisions are pinned to what Xólotl was tested with. Read each model card's licence before use
# (MiniMax H3, its turbo LoRA and the swap LoRA: MiniMax H3 Community License; SAM 3.1: its own licence; Veda: MIT;
# Qwen3-VL 8B, which describes the character: Apache 2.0; FLUX.2 [klein] 4B, its Qwen3 4B encoder and the FLUX.2 VAE,
# which make the creator's characters: Apache 2.0.)
#   usage: scripts/install-models.sh /path/to/ComfyUI [--fp8]
#   default: the int8 "convrot" H3 and video VAE, the files Comfy-Org recommends when ComfyUI runs PyTorch cu130
#            (CUDA 13 kernels) — about 68 GB in all, 16 GB of it the character creator's.
#   --fp8    the fp8 H3 and fp16 video VAE instead, for a ComfyUI that cannot use cu130 (about 68 GB, slower).
#   Xólotl runs whichever of the two is installed, and Veda only when its node (scripts/install-nodes.sh) is there.
set -euo pipefail
COMFYUI_DIR="${1:-${COMFYUI_DIR:-}}"; shift || true
[ -n "$COMFYUI_DIR" ] || { echo "usage: $0 /path/to/ComfyUI [--fp8]"; exit 1; }
FP8=0
for flag in "$@"; do case "$flag" in --fp8) FP8=1 ;; *) echo "unknown flag $flag"; exit 1 ;; esac; done
command -v hf >/dev/null || { echo "install the Hugging Face CLI first: python3 -m pip install -U huggingface_hub"; exit 1; }
M="$COMFYUI_DIR/models"
get() { hf download "$1" "$2" --revision "$3" --local-dir "$4"; }
# Comfy-Org's repackaged repos keep each file under split_files/<folder>/: it goes to models/<folder>/.
get_split() { local tmp; tmp=$(mktemp -d); hf download "$1" "split_files/$2" --revision "$3" --local-dir "$tmp";
  mkdir -p "$4/$(dirname "$2")"; mv "$tmp/split_files/$2" "$4/$2"; rm -rf "$tmp"; }
H3=912b6e38b2092ec4d2e86d24183e0d59ea059d48
if [ "$FP8" = 1 ]; then
  get Comfy-Org/MiniMax-H3 diffusion_models/minimax_h3_ref2va_pruned_fp8_scaled.safetensors $H3 "$M"   # 21 GB
  get Comfy-Org/MiniMax-H3 vae/minimax_h3_video_vae_fp16.safetensors                    $H3 "$M"   # 5.2 GB
else
  get Comfy-Org/MiniMax-H3 diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors $H3 "$M"   # 21 GB
  get Comfy-Org/MiniMax-H3 vae/minimax_h3_video_vae_int8_convrot.safetensors                $H3 "$M"   # 2.8 GB
fi
get Comfy-Org/MiniMax-H3 text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors   $H3 "$M"   # 15.7 GB
get Comfy-Org/MiniMax-H3 vae/minimax_h3_audio_vae_fp32.safetensors                    $H3 "$M"   # 0.6 GB
get Comfy-Org/MiniMax-H3 loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors $H3 "$M"   # 1.96 GB
get Comfy-Org/Qwen-Image-2.1 text_encoders/qwen3vl_8b_int8_convrot.safetensors aacf31a6d48e707f352ecba714cee0680da3479b "$M"   # 8.7 GB, describes the character
get Comfy-Org/sam3.1 checkpoints/sam3.1_multiplex_fp16.safetensors 7bb8374780a725b4353ed31f3a9395c9742b5621 "$M"   # 1.75 GB
get akatz-ai/MiniMax-H3-Character-Swap-LoRA h3_character_swap_v1.5.safetensors 96ea3407b230b6f7df71c58c70e31df96bd7e533 "$M/loras"   # 0.16 GB
get Veda-Sparse/Minimax-H3-R2VA-Veda-Preview minimax_h3_r2va_veda_preview_fp8.safetensors 1598b407905b7c0af85aa0c13acdfa6f01ff2982 "$M/veda"   # 0.28 GB
# The character creator (/create): FLUX.2 [klein] 4B, distilled (4 steps), the BF16 weights as GGUF for ComfyUI-GGUF.
get unsloth/FLUX.2-klein-4B-GGUF flux-2-klein-4b-BF16.gguf a09d5bb51ac4000ccd9643d10e9db3ed14200508 "$M/diffusion_models"   # 7.75 GB
KLEIN=5b3abca5c0dc1ecd4eaf3340868d09063fc1c965
get_split Comfy-Org/Flux-2-Klein-4B text_encoders/qwen_3_4b.safetensors $KLEIN "$M"   # 8.04 GB
get_split Comfy-Org/Flux-2-Klein-4B vae/flux2-vae.safetensors          $KLEIN "$M"   # 0.34 GB
echo "models are in $M — restart ComfyUI if it was running, then: npm run doctor"
