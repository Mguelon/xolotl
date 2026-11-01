# Measurements

One machine for everything: Ubuntu, RTX A4000 **16 GB**, 62 GB RAM, ComfyUI 0.41.2 in the `yanwk/comfyui-boot` cu130 image (PyTorch 2.11 on CUDA 13), the swap pack at `0670e4f`. Unless a row says otherwise: the bundled *Amara* take, a 5.1 s part of a 1344×768, 24 fps clip with audio, the same character image, seed 4048927270, 480p. Times are ComfyUI's own, `execution_start` → `execution_success`.

## The default recipe, through the app

`minimax_h3_ref2va_pruned_int8_convrot` with the `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16` LoRA at 4 steps, the `minimax_h3_video_vae_int8_convrot` VAE, `VedaSparseAttention` (R2VA predictor, 79 % sparsity) and the character-swap LoRA v1.5.

| Take | Time | Output |
|---|---|---|
| 5.1 s, from a freshly restarted ComfyUI, with the size-restoring nodes | **5 min 16 s** (315.7 s) | 1344×768, 122 frames: the clip's own size |
| 10 s, two 124-frame windows, before the size-restoring nodes | **11 min 15 s** (675.1 s) | 928×512, 240 frames: the pack's canvas |
| 5.1 s with the reference graph's settings: fp8 H3, fl2v 8-step turbo LoRA, fp16 VAE, no Veda | 11 min 46 s | 928×512 |

Where the 5.1 s take's time goes: SAM 3.1 tracked the 124 frames in 22 s; the 4 steps took 2 min 39 s, 39.75 s per step, the first one 47.5 s with the model's initialisation; the rest is loading every model after the restart, encoding the clip and its audio, the text encoder, decoding, and putting the result back at the clip's size. On the 896×512 canvas a step is faster than F's 42.4 s on the cropped 928×512 one: 3.4 % fewer pixels.

The 10 s take: preparing and tracking 84 s; window 1, 68 s of preparation and 3 min of sampling with its loads; decoding 22 s and preparing window 2 about 81 s; window 2, 3 min 30 s of sampling; the final decoding 29 s. The second window samples slower per step, 50.8 s against 42.8 s. Its jacket colour stays within 0.12 of run C's in each window, and the frame-to-frame change across the seam between windows follows the clip's own.

RAM: ComfyUI's container peaked at 46.1 GiB during the 5.1 s take (`docker stats` every 10 s) on the 62 GB machine. VRAM: ComfyUI's dynamic VRAM fills the 16 GB card in every run.

## How the recipe was chosen

One change per run from the reference settings, the same take, character and seed, on the pack's 928×512 canvas. Colour is the jacket's mean Cb / Cr (180×80 px at 150,240 of the canvas, frames 20–100); likeness is the SSIM of the person's region against run B. *cached* marks totals that reused SAM's track from an earlier run and *afresh* those that tracked again; for r2 and A it was not recorded.

| Run | Change | s / step | Total | Jacket Cb / Cr | Person SSIM vs B | Verdict |
|---|---|---|---|---|---|---|
| reference | fp8 H3, fl2v turbo 8 steps, through the app | ~67 | 11:46 | 121.73 / 132.86 | | baseline |
| r1 | ref2v turbo 4-step v0.1 LoRA, 4 steps | 67.6 | 7:05 afresh | | 0.990 | kept |
| r2 | fl2v 4-step v1.2 768p LoRA, shift 6 | 67.5 | 6:31 | | | dropped: black glossy face, green jacket |
| A | Singularity v1.3 w4a8 community merge | 51.9 | 5:21 | 124.48 / 126.21 | | dropped: jacket greener |
| B | r1 + int8 video VAE | 67.2 | 6:12 cached | 121.95 / 131.72 | 1 | kept |
| D | B + Veda, 32 tiles | 60.6 | 6:44 afresh, with Veda's compile | | 0.925 | E is faster |
| E | B + Veda, 79 % | 58.0 | 5:31 cached | 121.62 / 132.04 | 0.914 | kept |
| F | E with the int8 H3 | 42.4 | 4:33 cached | 121.78 / 132.07 | 0.910 | **default** |
| C | B on a 10 s part, two windows | 67.3 / 79.7 | 15:13 | | | reference for 10 s |

The background outside the person scores about 0.990 SSIM against B in every run. Veda's gain is small at 480p: at 928×512 it still computes 41.8 % of the attention at "79 %", a floor it cannot skip at this size (its predictor was trained at 1344×768). The int8 H3 is what cuts the linear layers: 15.6 s less per step.

## Size and aspect ratio

The swap pack centre-crops every clip to its canvas and returns the canvas: the 1344×768 clip became 928×512, 13 px lost at the top and the bottom at the clip's scale. Xólotl's two nodes keep the whole shot and give it back at the clip's size.

Checked on CPU with the pack's own PrepareVideo (`scripts/check-restore.py`): fake swaps over a fixed elliptical mask, compared with the clip cut the same way. *Outside* is more than 24 px from the mask's edge; *untouched* restores the prepared frames as they are; *one frame late* restores them shifted by a frame.

| Clip | Canvas | Output | Outside, Y / U / V | Inside, untouched, Y | Inside, one frame late, Y |
|---|---|---|---|---|---|
| 1344×768 | 896×512 | 1344×768 | 48.61 / 52.97 / 53.00 dB | 42.59 dB | 28.57 dB |
| 1344×768 from 2.5 s | 896×512 | 1344×768 | 48.17 / 52.43 / 52.45 dB | 42.02 dB | 26.17 dB |
| 1920×1080 | 928×512 | 1920×1080 | 48.74 / 53.21 / 53.24 dB | 42.89 dB | 28.66 dB |
| 720×1280 | 512×928 | 720×1280 | 48.59 / 53.86 / 53.79 dB | 46.63 dB | 27.94 dB |

Every output has the clip's frames and sound. The mean difference outside is +0.02 levels in every plane: the final encode and nothing else. Inside, U and V stay within 0.11 levels and Y within 0.43, so the colour comes back from the model's RGB as it went in. Every plane registers best at a shift of 0, 0, and a red square painted on the canvas lands within 2 px of its place at full size.

### Framing the person

The whole frame on a 0.5 MP canvas gives the person 67 % of their pixels per side in the terrace clip and 47 % in a 1080p one. *Frame the Person* takes the masks of a first pass over the whole frame, puts a crop around the person (20 % of room per side, aspect kept between 9:16 and 16:9) on the canvas instead, and *Restore Clip Size* pastes the swap back at the crop's place. The same check on CPU, the ellipse playing the first pass's person (`--frame-person`):

| Clip | The person's box, at full size | Crop | Canvas | The person's scale | Outside, Y | Marker at full size |
|---|---|---|---|---|---|---|
| 1344×768 | 591×614 | 838×768 at (252, 0) | 736×672 | **0.876** instead of 0.667 | 48.56 dB | at its place within 2 px |
| 1920×1080 | 844×863 | 1190×1080 at (364, 0) | 736×672 | **0.618** instead of 0.474 | 48.74 dB | within 2 px |
| 720×1280 | 318×1023 | the whole frame | 512×928 | 0.711, unchanged | 48.59 dB | within 2 px |

Every plane registers at 0, 0 and the output has the clip's size, frames and sound. The crop's canvas may be a little bigger than the whole frame's (494 k vs 459 k pixels for the terrace clip: 8 % more model work); the geometry alone says a standing person up to 80 % of a 1080p frame's height gets their native resolution at the same work. The cost is the first pass's tracking: about the tracking time again. Not yet measured on the GPU.

Through the app (`scripts/check-take.py`, the 5.1 s take above, before *Frame the Person*): 1344×768 and 122 frames, the same count as F. On the 44.7 % of the frame the swap left alone, the result matches the clip at 49.68 / 53.65 / 53.62 dB with biases under 0.03 levels, and that background's gradient is 1.03 times the clip's: as sharp as the original. The jacket reads 121.83 / 132.15 against 121.78 / 132.07 for F.

## The earlier recipe: fp8, 8 steps

The same 5.17 s clip (124 frames), the same character, seed 904239 in runs 1 and 2, `er_sde`, 480p on the pack's 928×512 canvas. VRAM and RAM sampled every 5 s with `nvidia-smi` and `free`.

| Run | H3 weights | Total time | VRAM peak | RAM used (peak − idle) | Result |
|---|---|---|---|---|---|
| 1 | `minimax_h3_ref2va_pruned_fp8_scaled` (Comfy-Org, 21 GB) | **11 min 30 s** | 15 712 / 16 376 MiB | +19 GB (weights stream from RAM) | identity stable across all 124 frames, scene and performance preserved |
| 2 | `Minimax-h3_Singularity_ref2va_v1.3_Pruned_w4a8` (community merge, 11.8 GB) | **8 min 55 s** | 15 716 / 16 376 MiB | +5 GB (weights fit the card) | same clip, same seed: equivalent identity and scene |
| 4 | fp8, **768p** through the app (1312×736, 34 891 video tokens, 14 584 regenerated), same *Amara* take and seed as run 3 | **30 min 21 s** (ComfyUI: `execution_start` → `execution_success`; 194 s per step, 3 min 18 s before the first) | 15 704 / 16 376 MiB | 48.7 GB used in total (62 GB machine) | same identity and scene as run 3 at twice the pixels |
| 3 | fp8 again, but through the app: browser → Comfy SDK → `comfy-api-proxy` → ComfyUI, bundled *Amara* take (5.1 s, 122 frames), seed 4048927270 | **11 min 46 s** (ComfyUI's `execution_start` → `execution_success`; the app's first estimate, counted from its first *running* poll, said 9 min 15 s — that undercount is why finished takes now read ComfyUI's timestamps) | 15.7 GB reported by ComfyUI's monitor during the run | not sampled | braids, skin, jacket and build follow the character; cup, gestures and smile follow the clip |

What the time contains: SAM 3.1 detection and tracking of the person, VAE encoding of the source clip and audio, the Qwen3-VL text encoder, 8 diffusion steps over one 124-frame window, decoding and MP4 assembly. ComfyUI's dynamic VRAM keeps the whole card busy either way; the difference is how much has to stream from system RAM each step.

Known limits (from the workflow's authors and confirmed here): the clip should be one continuous shot with the person visible in the first frame; with several people the largest one is swapped; the original soundtrack is kept, not regenerated; in run 1 the final frame shows the hand merged with a vase that sat inside the expanded mask.

Reference point: Comfy's own Openjutsu app reports about 2 minutes for a 5 s part at 480p on a Comfy Developer Platform deployment (GPU not published), with a first-frame anchor made by GPT Image through Comfy Router. Xólotl runs the same character-swap graph without any closed model.

What the time contains: SAM 3.1 detection and tracking of the person, VAE encoding of the source clip and audio, the Qwen3-VL text encoder, 8 diffusion steps over one 124-frame window, decoding and MP4 assembly.

Known limits (from the workflow's authors and confirmed here): the clip should be one continuous shot with the person visible in the first frame; with several people the largest one is swapped; the original soundtrack is kept, not regenerated; in run 1 the final frame shows the hand merged with a vase that sat inside the expanded mask.

Reference point: Comfy's own Openjutsu app reports about 2 minutes for a 5 s part at 480p on a Comfy Developer Platform deployment (GPU not published), with a first-frame anchor made by GPT Image through Comfy Router. Xólotl runs the same character-swap graph without any closed model.

## Install scripts, checked 2026-11-01

- `scripts/install-nodes.sh` run against an empty ComfyUI root installed Xólotl's nodes, `h3_character_swap` at `0670e4f` and `Veda-on-ComfyUI` at `67e4eb5`; compared with the copies that ran every take in this document (`sha256sum` for Xólotl's, `diff -r` for the two packs): identical.
- Every file `scripts/install-models.sh` fetches was HEAD-checked on Hugging Face at its pinned revision (HTTP 200). Default set, about 44 GB: H3 ref2va int8 convrot 21.0 GB, Qwen3-VL text encoder 15.7 GB, video VAE int8 convrot 2.8 GB, audio VAE 0.6 GB, ref2v turbo 4-step LoRA 1.96 GB, SAM 3.1 1.75 GB, Veda R2VA predictor 0.28 GB, swap LoRA v1.5 0.16 GB. `--fp8` swaps in the fp8 H3 (21.0 GB) and the fp16 video VAE (5.2 GB). The int8 H3 in use was downloaded and checked against Hugging Face's sha256 (`9255f52b…`).
