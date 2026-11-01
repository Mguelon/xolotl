# Measurements

All runs: one machine (Ubuntu, RTX A4000 **16 GB**, 62 GB RAM, ComfyUI 0.41.2 in the `yanwk/comfyui-boot` cu130 image, PyTorch 2.11), the same 5.17 s clip (124 frames, 24 fps, 1344×768, with audio), the same character image, seed 904239, 8 steps, `er_sde`, 480p (the pack scales the clip to 928×512). VRAM and RAM were sampled every 5 s with `nvidia-smi` and `free`.

| Run | H3 weights | Total time | VRAM peak | RAM used (peak − idle) | Result |
|---|---|---|---|---|---|
| 1 | `minimax_h3_ref2va_pruned_fp8_scaled` (Comfy-Org, 21 GB) | **11 min 30 s** | 15 712 / 16 376 MiB | +19 GB (weights stream from RAM) | identity stable across all 124 frames, scene and performance preserved |
| 2 | `Minimax-h3_Singularity_ref2va_v1.3_Pruned_w4a8` (community merge, 11.8 GB) | **8 min 55 s** | 15 716 / 16 376 MiB | +5 GB (weights fit the card) | same clip, same seed: equivalent identity and scene |

What the time contains: SAM 3.1 detection and tracking of the person, VAE encoding of the source clip and audio, the Qwen3-VL text encoder, 8 diffusion steps over one 124-frame window, decoding and MP4 assembly. ComfyUI's dynamic VRAM keeps the whole card busy either way; the difference is how much has to stream from system RAM each step.

Known limits (from the workflow's authors and confirmed here): the clip should be one continuous shot with the person visible in the first frame; with several people the largest one is swapped; the original soundtrack is kept, not regenerated; in run 1 the final frame shows the hand merged with a vase that sat inside the expanded mask.

Reference point: Comfy's own Openjutsu app reports about 2 minutes for a 5 s part at 480p on a Comfy Developer Platform deployment (GPU not published), with a first-frame anchor made by GPT Image through Comfy Router. Xólotl runs the same character-swap graph without any closed model.
