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

Every plane registers at 0, 0 and the output has the clip's size, frames and sound. The geometry alone says a standing person up to 80 % of a 1080p frame's height gets their native resolution for the same canvas.

On the GPU, the terrace take with the first version of the framing (the person tracked twice, once on the whole frame and once on the crop; same clip, character, seed and recipe as the 5 min 16 s take above):

| | Whole frame | Framed |
|---|---|---|
| Canvas | 896×512, 16 576 tokens, 8 138 regenerated | 608×800, 17 575 tokens, 10 683 regenerated |
| Sampling | 39.75 s per step | 47.28 s per step |
| ComfyUI, cold start | 5 min 16 s | 6 min 00 s |
| Fine detail on the person (Laplacian of Y, full size) | 6.13 | 6.80, 1.11× |
| Background outside the person | 49.68 dB | 49.65 dB |
| Jacket Cb / Cr | 121.83 / 132.15 | 121.61 / 132.65 |

The person fills 60 % of this frame, so the gain is modest and the crop's canvas regenerates 31 % more tokens: a step costs 19 % more. The two trackings cost 22 s each. The second version, now the default, tracks the person once and carries the first pass's masks onto the crop's canvas (IoU with the mask drawn there 0.998 on CPU), and never scales a crop above its native resolution. The same take: **5 min 34 s** (334.4 s), one tracking, 47.44 s per step, fine detail on the person 6.87 (1.12×), background 49.64 dB, jacket 121.51 / 132.83, sound 5.083 s with 5.083 s of picture. Framing costs this clip 19 s, 6 %, for 12 % more fine detail on the person; a person who fills less of the frame gains more for the same cost.

A 10 s part of the same terrace (fde01df1, same character and seed, two windows): **10 min 47 s** (647.2 s), against 11 min 15 s for the same part on the pack's canvas before Xólotl's nodes (ed24325b). The person crosses most of the frame in 10 s, so the crop is nearly the whole frame (an 896×512 canvas, 7 920 and 8 006 tokens regenerated) and framing adds nothing on this clip; the result still has 1.11× the canvas take's fine detail on the person (4.28 against 3.84; the clip has 4.55), since outside the mask it is the clip's own pixels. Windows at 39.6 and 47.1 s per step: the 18 frames of history make a step 1.19× longer, the same ratio as on the pack's canvas (42.8 and 50.8); 109 s between the two samplings (decoding the first window, encoding the second). Background 48.51 dB on the 20.5 % of the frame the swap left alone, jacket 121.89 / 132.38 against 121.96 / 132.25, 240 frames with 10.000 s of sound, ComfyUI's container at 35.3 GiB of RAM at most. The app's estimate before a take (`lib/estimates.ts`) is built from these runs: a range from the loose crop's step time to the tight one's, 5 % either way.

`scripts/check-take.py` now measures the fine detail itself, on the region the result moved: for the 5.1 s takes, 5.24 whole frame, 5.89 framed (1.12×), 4.84 for the pack's canvas take brought back to the clip's size, 6.16 for the clip. The figures differ from the table's because the region does (the table used the region both takes moved); the ratio is the same.

Through the app (`scripts/check-take.py`, the 5.1 s take above, before *Frame the Person*): 1344×768 and 122 frames, the same count as F. On the 44.7 % of the frame the swap left alone, the result matches the clip at 49.68 / 53.65 / 53.62 dB with biases under 0.03 levels, and that background's gradient is 1.03 times the clip's: as sharp as the original. The jacket reads 121.83 / 132.15 against 121.78 / 132.07 for F.

## Two nodes that save time

Between the person's tracking and the first window the pack grows the person's mask by 64 px with scipy's exact distance transform, frame by frame, and also builds a colour overlay of the whole clip that nothing reads. `scripts/time-prep.py` times it in the container on 243 frames: 10.3 s at 896×512 and 22.4 s at 1024×768. Xólotl's *Grow the Person's Mask* gives the same masks (checked against scipy pixel for pixel, `comfy_nodes/xolotl/test_masks.py`) with OpenCV's exact distance transform over 8 threads, without the overlay: 1.3 s and 2.4 s. On the GPU the 5.1 s take (6dbe3ceb) came out **byte-identical** to the 5 min 34 s take (d431fad3), all 122 frames: the pipeline repeats bit for bit with the same seed, and the growth saved 4.5 s before the first window (18.0 s to 13.5 s).

The pack also VAE-encodes the first window's frames twice: as H3's reference video, then for the latent kept outside the person. ComfyUI decodes a yuv420p clip to float RGB (`gbrpf32le`), and its lanczos resize, called for the reference even at the same size, hands the frames back rounded down to 8 bits, so the two encodes get frames up to 1/255 apart. Xólotl's *Reuse VAE Encodes* gives the second encode the first one's latent when its frames are exactly the first ones rounded down that way (`eight_bit` matches ComfyUI's resize bit for bit). The same take (3c3b914c): **5 min 08 s** (307.7 s, 26.7 s less than 334.4 s); the second encode took 2.4 s instead of 21.6 s. The person's context now comes from frames at most 1/255 darker, so the take is no longer byte-identical: 4.65 % of the pixels differ by more than 8 levels, all on the edges of the braids and features (a sheet of frame 100 with the difference ×8 is in the measurement folder); fine detail 5.81 against 5.87, jacket 121.60 / 132.74 against 121.51 / 132.83, background 49.63 dB against 49.64. To the eye the two takes are the same.

## Facial expressions

`generation.mp4` (720×1280, 24 fps, 13 s; a young woman dancing in a hallway, pursing her lips and blowing kisses to the camera), first 5 s at 480p, the *Amara* character and seed 4048927270, through the app. The person fills 95 % of the frame, so the crop is nearly the whole frame (512×928 canvas, 13 630 of 18 560 tokens regenerated). Same everything else in every row:

| Prompt | ComfyUI | Body and hands | Face |
|---|---|---|---|
| the pack's: *Replace the selected person in <Video 1> with the character in <Picture 1>. Preserve the source performance, scene and audio timing.* + the character's description | 5 min 01 s (3824b5a2) | follow the clip frame by frame | neutral: closed mouth where she purses her lips |
| + *Keep the reference character's face, hair and clothing. Follow the source performance's pose, gaze, blinking, facial expressions and visible mouth movements moment by moment.* | 4 min 08 s (e33bac45, first pass cached) | the same | neutral |
| the same, + *she purses her lips and blows kisses to the camera* | 4 min 05 s (45a0155a, first pass cached) | the same | **pursed lips and the kisses at the clip's frames** (12, 55), the identity kept |
| the person named and the list of what to keep, no gesture: *Replace the young woman with long brown hair in a white top in <Video 1> with the character in <Picture 1>, keeping that person's position, scale, pose, movements, gaze, blinking, facial expressions and visible mouth movements moment by moment.* + the same rest | 5 min 04 s (10c1e9a7) | the same | neutral |
| the same at 768p (the clip's own 720×1280 on a 736×1280 canvas) | 10 min 58 s (10b416ca), 105.5 s per step | the same | neutral |
| the same at 480p, with a 384×384 close-up of the face as `<Video 2>` (YuNet, followed and smoothed; *<Video 2> is a close-up of that person's face: copy its facial expressions and mouth movements exactly, moment by moment.*) | 6 min 41 s (412b4255, after a restart), 53.3 s per step against 42.5 | the same | neutral |
| the same at 480p without the close-up, 20 steps without the turbo LoRA, `res_multistep` on the `simple` schedule as H3's own template | 16 min 19 s (bb19a546), 42.2 s per step | the same | neutral, and less fine detail (2.58 against 2.76) |

The face does not follow the clip's gestures with this LoRA: not with the pack's wording, the list of things to keep or the person named, not at 768p, not with a close-up of the face as a second reference video (Mickmumpitz's approach; the nodes were taken out again, their code is kept with the measurements), not with H3's full 20 steps. A gesture written in the direction does appear, but at its own moments: in the 13 s take (cd7f6ce1) she smiles where the clip purses her lips. So the prompt names the person and what to keep, and describes no gesture. Akatz's model card warns that expressions "can still drift" and, in an earlier version, that "stronger expression instructions sometimes suppressed the swap"; here the swap held (jacket, braids and face unchanged, background 50.4–50.6 dB on the 5 % left alone). Fine detail on the person 2.75–2.76 in all three (the clip has 2.95). The app's prompt names the person to replace and the list of what to keep (`swapPrompt` in `lib/swap.ts`, an optional `person` field). The sheets with the faces of every take are in the measurement folder.

The other H3 swap LoRA, BFS's character swap v1.1 (Alissonerdx, 80.7 MB, its own licence: no SaaS), works without a mask: the clip goes in as a guide from frame 0 and the whole frame is regenerated, with its v1.1 prompt template as it is. Same clip, character and seed at 512×928: with our 4-step turbo 4 min 07 s (43.3 s per step), with its author's 8-step DMD turbo 6 min 14 s. Its face opens the eyes as the clip does and pushes the lips forward a little, but does not purse them either. How closely the mouth follows, frame by frame (`scripts/mouth-follow.py`: the mouth's width over the eyes' distance with YuNet's landmarks, correlated with the clip's; the clip moves between 0.70 and 0.89, spread 0.038):

| Take | Correlation with the clip | Spread |
|---|---|---|
| Akatz, 4 steps, the person named (10c1e9a7) | +0.30 | 0.029 |
| Akatz, 20 steps without turbo (bb19a546) | +0.40 | 0.028 |
| Akatz, gesture written in the direction (45a0155a) | +0.17 | 0.039 |
| BFS, 4-step turbo | +0.22 | 0.042 |
| BFS, 8-step DMD turbo | +0.24 | 0.045 |

A rough measure (a head turn also narrows the mouth on screen, and the head follows the clip in every take), but it agrees with the faces: nothing follows the mouth closely; BFS and the written gesture move it as much as the clip does, out of step with it.

What the sources say (2026-11-01): the official API guide (Runware) recommends a tight close-up as the performance reference, since "a clean close-up reads more accurately than a wide shot when the model is copying the expression"; Mickmumpitz's *Performance Capture* workflow does that with a DWPose face crop on grey as a second reference video; BFS's own character-swap LoRA (v1.1, guide-latent conditioning, custom licence) asks for "lip movement and facial expression, frame by frame" in its prompt. Those are the next things to try if a clip's gestures still get lost.

### The whole 13 s, and what a written gesture costs (2026-11-02)

The same clip, all 13 s at 480p (512×928 canvas, three windows), seed 4048927270, the person named and the list of what to keep, plus *She purses her lips and blows kisses to the camera.* in the direction. Mouth measured over all 310 frames (`FRAMES=312 scripts/mouth-follow.py`; the clip: 0.66-0.92, spread 0.047):

| Take | Reference | ComfyUI | Correlation | Spread |
|---|---|---|---|---|
| *Denim* (abd89408) | one full-body image | 20 min 51 s | **+0.55** | 0.051 |
| *Inés* (aae09e52) | atelier's simple sheet (front without the head, back, big face) | 17 min 04 s | +0.45 | 0.062 |

The lips purse at the clip's frames, but both takes put a hand to the mouth, blowing a kiss, where the performer has none (frames 194 and 280-296: the same seed and the same line, the same invented hand); a hand with no hand in the clip to follow comes out softer and odder than the rest. *Inés* moves the mouth a third more than the clip (spread 0.062 against 0.047), and when she smiles at the end her cheeks fold into deep creases: her reference only shows her face at rest. The faces are small for the model: the eyes are 82-84 px apart in the 720×1280 result (median; 60 in the farthest tenth), 59 px (43) on the 512×928 canvas, and H3's VAE divides each side by 16 (608×800 → 38×50 in the log), so an eye spans one or two latent cells and a finger less than one.

Mike, after watching both (2026-11-02): «es preferible que no haga gestos a que los haga feos». The prompt now only asks to keep the gestures, the poses and the proportions of everything, and nothing is written about the gestures themselves.

## 768p with the default recipe

The 5.1 s terrace take at 768p, same character and seed, run with `scripts/bake-run.mjs` from the framed 480p take's workflow (`fit`, `fit0`, `31` and `31a` at 768). The crop around the person goes on a 1024×768 canvas at its native size (28 416 video tokens, 15 537 regenerated). The candidate was lightx2v's ref2v 4-step LoRA v1.0 for 768p, against the default v0.1. Its model specs (ModelTC/Minimax-H3-Turbo) list v0.1 as trained at 544p with video shift 12, and the 768p LoRAs of the same series at shift 6, so it ran at both shifts.

| 768p, 5.1 s | ComfyUI | Per step | Fine detail on the person | Jacket Cb / Cr |
|---|---|---|---|---|
| ref2v 4-step v0.1, shift 12 (default) | **9 min 09 s** (549.2 s) | 87.1 s | **6.36** | 121.83 / 132.32 |
| ref2v 4-step v1.0 768p, shift 12 | 8 min 13 s, first pass cached | 86.8 s | 6.19 | 123.11 / 127.69 |
| ref2v 4-step v1.0 768p, shift 6 | 8 min 10 s, first pass cached | 86.5 s | 6.22 | 122.95 / 125.68 |
| 480p framed, for reference | 5 min 34 s | 47.4 s | 5.87 | 121.51 / 132.83 |

Detail on the region any of the four moved (`scripts/check-take.py --peer`); the clip has 6.15 there. The v1.0 LoRA samples at the same speed (the two shorter times are ComfyUI reusing the first pass it had cached), has less detail at both shifts and turns the olive jacket of the character a deeper green: v0.1 stays the default at 768p. At 768p the person comes out at native resolution, 1.08× the 480p take's detail, for 1.64× the time; the earlier fp8 recipe took 30 min 21 s for the same take. ComfyUI's container peaked at 49.6 GiB of RAM.

Veda at 768p: the canvas there, 1024×768, is one of the sizes its R2VA predictor was trained at, unlike the 480p ones. Its own budget (`trained`, 32 key tiles, for the generated video and the references) against 79 %, the same take and seed from the same workflow (`bake-run.mjs`, run D): **79.3 s per step against 87.1 s**, 8 min 34 s against 9 min 09 s with everything computed, jacket 121.62 / 132.42, fine detail 6.34 against 6.42, the same face, braids and hands to the eye. The app now uses `trained` at 768p and keeps 79 % at 480p (`VEDA_SPARSITY` in `lib/swap.ts`).

Through the app with everything above (a2cb4adf: Veda's trained budget, the mask growth, the encode reuse, which also fired at 768p): **7 min 58 s** (478.2 s), 79.3 s per step, jacket 121.74 / 132.49, fine detail 6.32, background 49.58 dB, 5.083 s of sound with 5.083 s of picture, ComfyUI's container at 36.9 GiB of RAM at most.

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
