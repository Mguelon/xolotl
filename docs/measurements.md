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

## The workflow without the app (2026-11-02)

`workflows/xolotl.api.json` run end to end as someone would from the editor (`scripts/standalone-run.py`: the clip in *Load Video*, the picture in *Load Image*, the default 5 s, queue): **5 min 27 s** (327.1 s), 720×1280 like the clip, 120 frames at 24 fps with its audio. Its own nodes wrote the prompt, and Gemma's description of the picture came out word for word the one the app wrote for it (take 2d45a004): the same model, greedy, at the same 1120 image tokens. The character holds through the five seconds (sheet in the measurement folder, `sin-app/`).

Where a 5 s take's time goes, node by node (`scripts/standalone-run.py` now listens on ComfyUI's websocket and times every node from its `executing` message to the next; a second run of the same inputs after `/free`, which empties ComfyUI's node cache and unloads the models: 318.6 s, the 64 nodes that ran summing 318.6 s; `sin-app/tiempos-por-nodo.json`):

| s | Node | What it is |
|---|---|---|
| 185.9 | SamplerCustomAdvanced (inside the pack's Controller) | H3's four steps, 2:59 at ~45 s a step, with ~7 s to load the 20 GB of H3 and start Veda |
| 43.9 | H3CharacterSwapReference | the reference video through the VAE (~28 s), its audio, and Qwen3-VL, H3's text encoder (15 GB, ~15 s) |
| 21.9 | SAM3_VideoTrack | SAM 3.1 tracking the person, first pass |
| 17.1 | VAEDecode | decoding the window |
| 8.3 | Xólotl · Find the Person on Empty Frames | 13 empty frames, one SAM call |
| 6.4 | Xólotl · Restore Clip Size | the swap laid over the clip's own frames and encoded |
| 5.0 | TextGenerate | Gemma describing the picture |
| 3.0 + 2.9 | H3CharacterSwapPrepareVideo ×2 | the pack's preparation, both passes |
| 2.3 | H3CharacterSwapMaskedRegeneration | 2.3 s because *Reuse VAE Encodes* spared the second encode |
| 1.4 + 1.3 | Xólotl · Fit Clip on Canvas ×2 | the clip, then the crop, on the canvas |
| 0.7 / 0.7 / 0.6 / 0.2 | Xólotl · Face Close-up / Masks onto the Crop / Grow the Person's Mask / Frame the Person | |

Xólotl's ten nodes in this graph sum 19.6 s, 6 % of the take; the loaders take almost nothing because ComfyUI's dynamic VRAM loads the weights where they are used. Seven nodes of the template neither run nor come from the cache: the pack's own tracking on its canvas (102-107, the path the app takes only without Xólotl's nodes) and the `CreateVideo` of that path. The pack also keeps generated windows in RAM for 30 min (`relay/records.py`) and restores them instead of generating when the same shot comes back: a timing run must wait that out, or it measures a restore.

A clip without an audio track (the same 5 s with the track stripped, `sin-app/renata-5s-sin-audio.mp4`) runs through the same workflow: 5 min 15 s (315.0 s), and the result has no audio track either, as it should (`sin-app/hoja-sin-audio-5s.png`: frame for frame the same take as with the audio). *Fit Clip on Canvas* passes no audio on when the clip has none, the pack's registered *Prepare Character Swap* takes that, and *Restore Clip Size* writes the result without a track.

## Three nodes that save time

Between the person's tracking and the first window the pack grows the person's mask by 64 px with scipy's exact distance transform, frame by frame, and also builds a colour overlay of the whole clip that nothing reads. `scripts/time-prep.py` times it in the container on 243 frames: 10.3 s at 896×512 and 22.4 s at 1024×768. Xólotl's *Grow the Person's Mask* gives the same masks (checked against scipy pixel for pixel, `comfy_nodes/xolotl/test_masks.py`) with OpenCV's exact distance transform over 8 threads, without the overlay: 1.3 s and 2.4 s. On the GPU the 5.1 s take (6dbe3ceb) came out **byte-identical** to the 5 min 34 s take (d431fad3), all 122 frames: the pipeline repeats bit for bit with the same seed, and the growth saved 4.5 s before the first window (18.0 s to 13.5 s).

The pack also VAE-encodes the first window's frames twice: as H3's reference video, then for the latent kept outside the person. ComfyUI decodes a yuv420p clip to float RGB (`gbrpf32le`), and its lanczos resize, called for the reference even at the same size, hands the frames back rounded down to 8 bits, so the two encodes get frames up to 1/255 apart. Xólotl's *Reuse VAE Encodes* gives the second encode the first one's latent when its frames are exactly the first ones rounded down that way (`eight_bit` matches ComfyUI's resize bit for bit). The same take (3c3b914c): **5 min 08 s** (307.7 s, 26.7 s less than 334.4 s); the second encode took 2.4 s instead of 21.6 s. The person's context now comes from frames at most 1/255 darker, so the take is no longer byte-identical: 4.65 % of the pixels differ by more than 8 levels, all on the edges of the braids and features (a sheet of frame 100 with the difference ×8 is in the measurement folder); fine detail 5.81 against 5.87, jacket 121.60 / 132.74 against 121.51 / 132.83, background 49.63 dB against 49.64. To the eye the two takes are the same.

Where SAM's tracking comes back empty (164 of the 328 frames of the 13 s test clip at 480p), the pack's *Recover Empty Frames* looks for the person again with one SAM 3 Detect call per frame, and every call gets SAM ready again. Xólotl's *Find the Person on Empty Frames* (2026-11-02) lets the pack's node list those frames, hands them to SAM 3 Detect 32 at a time with the same settings, which still reads them one by one, and lets the pack's *Select Person* pick on each. `scripts/recover-bench.py` ran the first pass of take 2d45a004 four times, pack and Xólotl in turn, the tracking kept from the run before: the masks are the same in every run, **0 pixels differing** in 328 frames, and the recovery with the saving of its masks took 141.8 s with the pack's node against 111.9 s and 111.4 s with Xólotl's: **30 s less** per 13 s take. Getting SAM ready cost about 0.2 s a frame; the remaining 0.6 s a frame is SAM's own detection and its two refinements, which are what give these masks.

The whole take again with the node (bb1ad98f: same clip, character, description and seed as 2d45a004, 13 s, three windows): **16 min 49 s** against 17 min 32 s. Where it goes, from ComfyUI's log: 56 s before the tracking (loads, the clip on the canvas, the first detection), 60 s tracking 328 frames, 1 min 44 s finding the person on the 164 empty frames, then per window the reference encode (29.8 / 33.8 / 22.4 s), Qwen3-VL, H3's own text encoder (15.5 / 15.4 / 11.4 s), the masked latent (2.3 s, the encode reused / 35.2 / 24.7 s), the four steps (3:03 at 45.6 s a step / 3:33 at 53.4 s, 141 frames with the history / 1:57 at 29.3 s, a shorter last window) and the decode (28 / 28 / 39 s with the result put back at the clip's size). During the steps the 20 GB of H3 with its LoRAs do not fit on the 16 GB card and ComfyUI's dynamic VRAM brings the rest from RAM; at PCIe speed that is about 1 s of each step, the rest is the card computing.

Why 164 frames come back empty: the tracking lost the person at frame 161, in the turn, and never found them again. With `max_objects` 1 the initial mask fills the only slot, and SAM 3.1's tracker runs no detection at all while every slot is taken (`comfy/ldm/sam3/tracker.py`, `run_det`), so a lost track stays lost and every frame after it goes to the per-frame search. Tracking again from the first lost frame would take about 0.18 s a frame instead of 0.6, about a minute less on this clip, but it would give tracked masks where the pack gives detected ones; not done.

The 13 s take that took 12 min 38 s (cd7f6ce1, 2026-11-01, same clip and graph) did not track the person: its first window's encoding starts 1 s after ComfyUI got the prompt, because ComfyUI kept the tracking and the per-frame search from the two takes of the same clip cancelled just before it (8114409b, d02dd698). With that first pass, about 3.5 min, a full run of those 13 s was about 16 min from the start. Its steps against bb1ad98f's: 42.5 / 50.2 / 27.3 s against 45.6 / 53.4 / 29.3 s; the difference is the face close-up, one more reference for H3 (Veda: 2 spans then, 3 now).

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

With that prompt, an empty direction, the person not named and one full-body image of a new character (*Renata*, 036d14b7, 17 min 08 s): the mouth follows the clip at **+0.73** (spread 0.048), because the face is not swapped. Whose face each take shows (`scripts/identity-follow.py`: insightface buffalo_l, every 12th frame, cosine similarity to the character's reference and to the clip's face in the same frame):

| Take | Reference | Like the character | Like the clip | Frames closer to the clip |
|---|---|---|---|---|
| *Denim* (abd89408), described, gesture line | one full-body image | 0.23 | 0.38 | 81 % |
| *Inés* (aae09e52), described, gesture line | simple sheet with the big face | **0.28** | **0.15** | 8 % |
| *Renata* (036d14b7), the plain prompt, nothing described | one full-body image | 0.02 | **0.81** | 100 % |

The big face in the reference is what carries the identity: from a full-body image, where the face is small, the take keeps most of the clip's face, and all of it with nothing described. *Renata*'s sweater also turns into the performer's cropped top, with her figure, between seconds 4 and 6.

### The character's face as a second picture (2026-11-02)

The fix has to hold for any picture someone uploads, so it went into the graph, not into the choice of character. The first 4.8 s of the same clip (115 frames, one window, 480p, seed 4048927270, the plain prompt), *Renata*'s one full-body image as `<Picture 1>`, and one thing changed per take (`scripts/bake-run.mjs`, `scripts/measure-take.sh`):

| Take (4.8 s) | What else H3 gets | Like the character | Like the clip | Frames closer to the clip | Mouth | ComfyUI |
|---|---|---|---|---|---|---|
| `renata48-base` | nothing | 0.15 | **0.61** | 100 % | +0.51 | 5 min 03 s |
| `renata48-ancla` | a first frame: the clip's frame redrawn as her by Qwen-Image-Edit 2511, her face warped on, as the anchor | 0.39 | 0.21 | 40 % | +0.59 | 5 min 44 s |
| `renata48-cara` | a close-up of her face drawn by 2511, as the segment reference (`<Picture 2>`) | 0.48 | 0.14 | 0 % | +0.48 | 5 min 12 s |
| `renata48-recorte` | **her face cut from her own picture and enlarged** (`XolotlFaceCrop`), as the segment reference | **0.53** | 0.15 | **0 %** | **+0.60** | 5 min 12 s |

The anchor holds her face until she turns (frame ~84) and then loses it to the performer, white top and grey jeans included. A close-up of her face as a picture of its own keeps her in every sampled frame, and cutting it from the uploaded picture does better than drawing it: her own face, not a redrawing of it, with no edit model (about 22 GB) and no extra time. The mouth follows the clip more closely too. The prompt adds one sentence after the first: *<Picture 2> is a close-up of the same character's face.* (`<Picture 3>` when an anchor comes first).

`XolotlFaceCrop` finds the largest face with YuNet (OpenCV Zoo, MIT, 227 KB, bundled in `comfy_nodes/xolotl/models/`) and cuts a square 2.5 face heights wide with the face's centre at 37 % from the top, the framing of the drawn close-up; a picture smaller than that is enlarged with Lanczos. On *Inés*'s simple sheet it picks the big face. A picture where it finds no face goes to H3 whole, so a take never stops for it.

The same test with *Inés*, whose reference is atelier's simple sheet, so a big face is already in `<Picture 1>` (the node picks that face for the close-up):

| Take (4.8 s) | What else H3 gets | Like the character | Like the clip | Frames closer to the clip | Mouth | ComfyUI |
|---|---|---|---|---|---|---|
| `ines48-base` | nothing | 0.33 | 0.11 | 0 % | +0.27 | 5 min 26 s |
| `ines48-cara` | her face cut from the sheet (`XolotlFaceCrop` in the graph) | **0.39** | **0.09** | 0 % | **+0.57** | 5 min 29 s |

With the face already big in the sheet the identity was there, and the close-up still adds to it; the mouth follows the clip twice as closely (correlation +0.57 against +0.27).

**The Rigless LoRA** ([StephenShumway/rigless-lora](https://huggingface.co/StephenShumway/rigless-lora), a fine-tune of Akatz's v1.5 on real footage, MiniMax H3 Community License) in place of v1.5, everything else as `renata48-recorte`: like the character **0.36**, like the clip **0.39**, closer to the clip in 60 % of the frames, mouth +0.64, 5 min 11 s. Her face narrows and takes the performer's lips; with v1.5 it keeps her freckles, brows and round face. Its authors find it no better at face identity and better at keeping a dancer's back to the camera; Rigless runs it beside an 8-step turbo LoRA, and Xólotl runs the 4-step one. Xólotl keeps v1.5.

### The mannequin (2026-11-02)

The whole 13 s with the close-up, through the app (59b8ef94, 17 min 12 s): like the character **0.43**, like the clip 0.29, closer to the clip in 27 % of the 26 sampled frames, mouth +0.66 (spread 0.051). Frame by frame (`PER_FRAME=1 scripts/identity-follow.py`) the character holds from 0 to 3.0 s and from 7.0 s on, and between 3.5 and 6.5 s, the dancer's turn, the take shows the performer's face (0.60 like the clip at 4.0 s), her dark wine hair and her cropped top with the belly showing, in the character's yellow; the wine hair comes back on the character's head at 8-9.5 s. The masks were not the cause: tapped out of the graph (`scripts/bake-run.mjs --tap 107a --tap 110`), SAM's mask and the grown one cover her head, hair and belly in every frame. H3 regenerated them and copied the performer's looks from the clip it follows for the motion.

Nor the windows. For 13 s the pack plans three (`planning.py`: 0-123, then 123-246 and 246-311, each after 18 frames of the window before as history), so the slip starts inside the first window, before any cut, and the history carries it into the second until 6.5 s. The first window run alone (`r124-sin-corte`: 124 frames, no cut, the same seed) gives the same frames: at 3.5 s 0.28 like the character and 0.32 like the clip, at 4.0 s 0.20 and 0.59 (0.19 and 0.60 in the 13 s take), at 4.5 s 0.31 and 0.54. The 4.8 s take that held through the turn (`renata48-recorte`) differs from that window only in its last 9 frames, the last one repeated instead of the dance going on: without the mannequin the turn is a coin toss.

D3voz's OPENjutsu hides those looks from H3: the person in the motion reference becomes a grey figure, the shading kept and blurred, the colours gone (`H3GreyMannequins`, MIT). Xólotl's `XolotlMannequin` does the same with their numbers (grey = 0.45 + 0.45 × luma, the body's luma blurred with sigma 8 px on the canvas, the face's green channel with 5 % of the face's height), only in the reference H3 reads: the result is still laid over the clip's own frames. Same seed and settings, the whole 13 s:

| 13 s | Like the character | Like the clip | Frames closer to the clip | Mouth | ComfyUI |
|---|---|---|---|---|---|
| close-up | 0.43 | 0.29 | 27 % | **+0.66** | 17 min 11 s |
| close-up + mannequin | **0.65** | **0.07** | **0 %** | +0.38 | 17 min 56 s |

With the mannequin the character holds all the way: her auburn hair, her freckles and her sweater tucked into her jeans through the turn. Her face also stays calm: no pout where the performer pouts. On the first 4.8 s, the face's treatment against the gestures:

| 4.8 s | Like the character | Like the clip | Mouth |
|---|---|---|---|
| close-up, no mannequin (`renata48-recorte`) | 0.53 | 0.15 | **+0.60** |
| mannequin, the face grey and sharp (`face_blur` 0) | 0.58 | 0.11 | +0.42 |
| mannequin, the lips darkened by their red (×1) | **0.61** | 0.12 | +0.40 |
| mannequin, the face left in colour | 0.40 | 0.25 | +0.53 |

A grey face, sharp or with the mouth drawn dark, doesn't bring the pout back; a face left in colour brings part of it back and the performer's face with it. Mike's choice (2026-11-02): the mannequin by default, and a **Copy gestures** switch that turns it off; since the character described (below), it is off by default.

The first version took 46 s for the 13 s on the CPU, one frame after another (YuNet keeps state per call). Blurring the body at half size, looking for faces at half size, painting only the person's box and the faces' detail only around each face, with one YuNet per thread writing straight into the result: 4.3 s with 16 threads (5.5 s with 8), the same frames within 0.07/255 on average (99.9th percentile 2.3/255).

### The gestures back (2026-11-02)

The mannequin's take keeps the character and loses the pouts. The two entries that give the gestures back, OPENjutsu's *Fix faces → Follow the mouth* and H3 Recast's *Lip repair*, both run a second H3 pass on the face (ComfyUI-H3-FaceRefine): 16 to 28 minutes more per take by their own figures. LivePortrait moves a face with another face's expressions and takes seconds; none of the 21 entries read in full uses it. Kijai's ComfyUI-LivePortraitKJ (MIT; LivePortrait's weights, MIT) over the mannequin's 13 s take, the clip as the driving face, its BlazeFace / face-alignment detector (InsightFace's models are non-commercial; MediaPipe 1.2 on this Python lacks the module the node imports):

| 13 s, the mannequin's take | Like the character | Like the clip | Mouth | The pout at 0.5 s | The open mouth at 1.7 s |
|---|---|---|---|---|---|
| no LivePortrait | 0.67 | 0.08 | +0.14 | no | no |
| LivePortrait, relative to the clip's first frame | 0.62 | 0.06 | +0.11 | no | yes |
| LivePortrait, absolute | 0.64 | 0.07 | +0.11 | no | no |
| LivePortrait, relative to a calm frame of the clip | 0.59 | 0.06 | +0.19 | **yes** | **yes** |

Relative motion copies each frame's expression as a change from one frame of the clip, its first by default, and this clip opens on a pout: the pout was the face at rest, so it never passed on. Put first a frame where the performer is calm (and the swap's frame at the same moment), and the pouts, the open mouth and a wink come through on the character's own face; the kiss with the head tilted at 11.8 s does not. Nothing shows at the paste's edge, and frames where the cropper finds no face keep the swap as it is. The mouth measure moves less than the eye sees (+0.19): it reads the mouth's width, and a pout pushes the lips forward more than it narrows them.

`XolotlNeutralFace` picks that frame on its own: YuNet's five points on every other frame of the clip, and among the faces that look at the camera (the nose within 0.12 eye distances of the eyes' middle, the eyes level within 0.15), the one whose mouth width over eye distance is the median. On this clip it picks frame 198, a calm closed mouth like frame 120 picked by eye, in 1.3 s (frame 192 on the 480p canvas, inside the take). Mike chose it on by default (2026-11-02) before seeing the whole take; it is off now, below.

In the template the pass runs on the canvas, between the pack's assembled frames and *Restore Clip Size*, so the clip's frames on the same canvas drive it frame for frame and the swap is encoded once. The whole 13 s through the app (331ce285): **20 min 12 s** against 17 min 21 s without it, like the character 0.57, like the clip 0.07, closer to the clip in 0 % of the frames, mouth +0.12; the open-mouthed pout at 1.7 s, the narrowed eyes at 9.6 s and the wink at 12.2 s come through, the pout at 0.5 s softer than on the full-size video, and the tilted kiss at 11.8 s not.

And it costs more than it gives back. Frame by frame against the mannequin's take (`renata-pruebas/manos-cabeza.jpg`: the clip, no mannequin, the mannequin, the mannequin and LivePortrait), the hands that come near the face are smeared at 2.8, 3.0 and 7.1 s, and at 6.7 and 11.9 s the head tips back with the chin up: LivePortrait warps the whole square around the face, the hand in it included, and its relative motion applies the clip's head turns to a swap that already follows them, so the head turns twice. Mike (2026-11-02): «vamos para atrás, se le borran las manos, la cabeza pierde las proporciones», as he had put it before, «es preferible que no haga gestos a que los haga feos». The pass stays in the template as an experiment, off unless asked for (`gestures=on`), and the interface does not offer it. It was removed from the template, the installer and the app on 2026-11-02; the node `XolotlNeutralFace` and its tests are in commit `6adbe77`.

### The character described (2026-11-02)

Both ways that keep the performer's looks out of the mannequin's take, measured on the same 13 s, seed and settings:

| 13 s | Like the character | Like the clip | Frames closer to the clip | Mouth | The turn | ComfyUI |
|---|---|---|---|---|---|---|
| the full-body picture alone, no close-up (036d14b7) | 0.02 | 0.81 | 100 % | +0.73, the performer's own | the performer's cropped top in beige | 17 min 8 s |
| close-up (59b8ef94) | 0.43 | 0.29 | 27 % | +0.66 | cropped top, the belly showing | 17 min 12 s |
| close-up + mannequin (7fd9d6f5) | **0.67** | **0.08** | **0 %** | +0.14 | sweater down | 17 min 21 s |
| close-up + mannequin, the head kept in colour | 0.00 | 0.87 | 100 % | +0.79, the performer's own | the performer's white top and belly | 17 min 26 s |
| **close-up + the character described** | 0.56 | 0.13 | **0 %** | **+0.63** | **sweater down** | 13 min 48 s, SAM's track cached |

The head kept in colour over a grey body (the grey starting 0.15 face heights under the chin) gives the performer back whole: her face, her white turtleneck and her belly, only the sleeves in the character's yellow. The grey keeps the clothes' light and shade, and the white collar in colour is enough for H3 to fill in the rest.

The described take adds one sentence to Mike's prompt, what the character looks like and nothing about the gestures: *The character is a young woman with long wavy auburn hair, green eyes, thick dark eyebrows and freckles, wearing a mustard-yellow crew-neck knit sweater that reaches the waistband of her light-blue high-waisted jeans, and white sneakers.* No frame shows the performer, the sweater stays down through the turn, and the mouth follows the clip as without the mannequin: the open mouth at 4 s, the smiles, the hand to the mouth at 6.5 s; the kiss at 12 s and the wink at 12.3 s do not come through, and no hand is made up at the end, where the mannequin's take drew one at 12.3-13 s. Its ComfyUI time is lower because SAM's track and the frames before it were cached from the run before (the same clip file); through the app every take tracks afresh. Mike (2026-11-02): «esta es la mejor de todas, es la que vamos a usar». The mannequin stays as an option, off by default (`mannequin=on`).

An earlier take had already pointed this way: Amara's 13 s take (cd7f6ce1, 2026-11-01) described her in the direction, gestures included, and shows her face; its hand blowing kisses, where the performer has none, came from *blows kisses* in that direction (above, "Facial expressions").

### Describing the character (2026-11-02)

Through the app with no description (b439edd3, the same 13 s, picture and settings), the performer came back: her face won in 9 of the 26 sampled frames, all 7 of the turn, with her white top and her belly. So the app writes the description itself when the picture is chosen, and the user can change it. Four small vision models, each run through ComfyUI on the same four pictures (Renata, Amara, Denim, Inés) with the same instruction, the first picture with the model loading (`scripts/describe-bench.py`; what each wrote is in the measurements' `descripciones/runs.jsonl`):

| Model | Size | Each picture after the first | The first (loads) | How far each garment reaches | Mistakes |
|---|---|---|---|---|---|
| Florence-2 large (Kijai's node, `more_detailed_caption`) | 0.77B | 1.2-6.0 s | 6.9 s | no | describes the background and makes up poses; takes no instruction |
| Qwen3.5-0.8B (transformers, through a loader node, 5c658ec) | 0.87B | 12.6-14.8 s | 14.4 s | yes | Renata's eyes brown, freckles on Inés, who has none, Amara's jacket down to mid-thigh |
| SmolVLM2-500M | 0.5B | — | — | — | did not run: it needs `num2words`, which ComfyUI does not ship |
| **Gemma 4 E2B int8** (ComfyUI's own Generate Text) | 2.3B effective | **2.0-2.4 s** | 7.3 s | **yes, on all four** | leaves out Renata's freckles |

Qwen3.5 runs slowly inside ComfyUI because its linear-attention layers fall back to plain PyTorch there (no `flash-linear-attention` or `causal-conv1d` kernels). Gemma needs no node of its own: ComfyUI's text-encoder loader recognises it and Generate Text runs it greedily (`sampling_mode` off), so the same picture always gets the same words. What it wrote for Renata: *The character is a young adult with a slender build and long, wavy, reddish-brown hair that falls past the shoulders. They have light-colored eyes and well-defined eyebrows. They are wearing a bright mustard yellow, long-sleeved, crew-neck sweater that fits relatively snugly and extends to cover the waist area. This is paired with medium-wash blue denim jeans that have a straight leg fit and reach down to the ankles. On their feet, they are wearing white lace-up sneakers with white soles.*

The description goes into the prompt after its tag, `<Picture 1>: The character is …`, the way H3 labels the picture itself (`comfy/text_encoders/minimax.py` puts `<Picture N>: ` before each image's tokens and `<Video N>: ` before each clip's), and the user's direction, if any, comes after it. Through the page as a user would, only the clip and the picture chosen, the description appeared 8.9 s after the picture and Transform waited for it. That take (f01fe819, the same 13 s and picture, seed 2136737094 drawn by the app, 17 min 46 s) kept the performer out of every sampled frame:

| 13 s through the app | Like the character | Like the clip | Frames closer to the clip | The turn (3.5-6.5 s) | Mouth |
|---|---|---|---|---|---|
| no description (b439edd3) | 0.44 | 0.30 | 9 of 26 | 7 of 7 | +0.73, partly the performer's own |
| described by hand (the bake above) | 0.56 | 0.13 | 0 of 26 | 0 of 7 | +0.63 |
| **described by Gemma** (f01fe819) | 0.52 | 0.12 | **0 of 26** | **0 of 7** | +0.54 |

Its ending is wrong, though: from about 11.5 s, where the performer leans into the camera, the character steps back down the hallway and shows her whole body, sneakers included, while the other takes follow the lean; and its first 8 frames carry a blue blot on the sweater. The same take and seed with only Gemma's last sentence taken out (*On their feet, they are wearing white lace-up sneakers with white soles.*, `bake-run.mjs` from f01fe819, 17 min 24 s) follows the lean to the end and has no blot. With this seed, the sentence about the feet, which the clip does not show at its end, pulled H3 into showing them.

So Gemma's instruction changed, tried on the same four pictures before any take (`DESCRIBE_INSTRUCTION=… scripts/describe-bench.py`; the versions are kept with the measurements, `descripciones/instrucciones/`). Asking it only to leave the shoes out also lost the sweater's length for Renata (*fits snugly on the upper body*) and put Amara's bomber at mid-thigh. A fill-in pattern of one sentence came out terse and made things up when told always to say where the top ends (Inés's *t-shirt that reaches her shoulders*, her leather jacket gone), and wrote what was missing (*no visible eyebrows*). What works is three sentences, with an invented example in the same form that matches none of the pictures: the person (apparent age, build, skin tone, hair, eyes, freckles, glasses or make-up), the garments on the upper body with how far each reaches, then the trousers, skirt or dress; nothing about the shoes or the feet. Renata's: *The character is a young woman with a slender build, fair skin, long wavy auburn hair, and green eyes. She is wearing a bright yellow, long-sleeved, crewneck sweater that reaches to her hips. She is wearing medium-wash blue denim jeans that have a straight fit.* All four came out right in garments and lengths, nothing from the example crept in, and Gemma still misses Renata's freckles and calls Denim's skin medium.

Through the page with that instruction, only the clip and the picture chosen (60a47859, seed 1992313880 drawn by the app, 17 min 20 s): like the character 0.54, like the clip 0.11, the performer in 0 of 26 frames and 0 of 7 in the turn, mouth +0.64; no blot at the start, the sweater down through the turn and the lean followed to the end, as the take described by hand.

Character sheets (a face close-up beside the full body, five presets from Higgsfield's gallery, one of them with a pink beehive and a black leather corset over a black shirt) are where that instruction fell short: through the page with the pink-haired one (cd9e8308, 17 min 27 s) the performer stayed out (like the character 0.51, like the clip 0.19, 0 of 26 frames), but Gemma had written *a black collared shirt* and no corset, and the corset showed only in the middle window, 3.5-6.5 s: what the description leaves out, each of H3's three windows decides on its own. The beehive came out flattened, being taller than the performer's silhouette.

What was tried on the nine pictures (the four above and five sheets; everything in the measurements' `descripciones/`):

| Gemma 4 E2B | Each picture | Renata's sweater | The sheets | The corset |
|---|---|---|---|---|
| the instruction above, Generate Text's 280 image tokens | 2 s | reaches the hips | a *long tunic* for track pants, the open jacket missed | no |
| the same, thinking mode | 9-10 s | reaches the waist (eyes turned blue) | jackets and track pants right | no |
| a list of garments first, then the description | 4 s | *covers the torso* | lengths made up (*ends at the shoulders*) | no |
| Mike's question (*Describe exactly the type, colour and shape of this person's clothes, with precision, and also their facial features, hair, eye colour and other characteristics*), then a rewrite into three sentences | 8-9 s | to the upper hips | a blue tank top under an open shirt, distressed jeans; the blonde afro became *a faux-fur hat* | no |
| the same with a third pass that checks the description against the picture | 16-20 s | to the upper hips | the check confirmed the hat | *a corset-like detail* in the check only |
| Mike's question, 1120 image tokens | 9-11 s | freckles seen, to the hips | the afro a wig again, the plaid shirt under the shaggy jacket; track pants called *a long skirt* | named, with its straps and buckles |
| an observant costume designer as its system prompt | 5-7 s | to the waist | more cautious: the open shirt and the corset gone | no |
| **the instruction above, 1120 image tokens** | **2.3-2.8 s** | **reaches the hips** | track pants with side stripes, the open shirt, frayed jeans; the afro's jacket only *a lime green knitted cardigan* | **named, with the lace at the cuffs** |

Asked directly (*Is there a garment worn over the black shirt, around the torso?*), Gemma described the corset, buckles and straps at 280 tokens too: it sees it, but leaves it out of a general description until the picture reaches it with more detail. ComfyUI's Generate Text tokenizes every image with 280 tokens (`max_soft_tokens`, about 0.65 MP; Renata's face reaches it 72 px wide) and does not expose the budget; Gemma 4's vision encoder takes up to 1120 (10 240 patch positions, 9 per token). Xólotl's *Let Gemma See More of the Picture* (`XolotlImageDetail`) hands the loaded Gemma on with that budget for every image it reads, and the describe workflows use it at 1120: the same instruction, the same 2-3 s, and the corset and the cuffs named.

### Qwen3-VL 8B instead of Gemma (2026-11-02)

On Higgsfield's third sheet, a bodybuilder, Gemma 4 E2B wrote "slender" or "lean" in all 17 of its descriptions
(every instruction above, thinking mode included), and a take with that description would have drawn him thin.
ComfyUI's same *Generate Text* runs Qwen3-VL 8B (`qwen3vl_8b_int8_convrot`, Qwen-Image 2.1's text encoder from
Comfy-Org, Apache 2.0, 8.7 GB; the file keeps the vision tower and `lm_head`) with the same instruction and without
Xólotl's image-token node, which only Gemma needs. On the nine pictures (`scripts/describe-bench.py`,
`descripciones/runs.jsonl`):

| Picture | Gemma 4 E2B | Qwen3-VL 8B |
|---|---|---|
| sheet 3, a bodybuilder | slender or lean, 17 of 17 | **muscular**, a cropped polo over a bare midriff, the open olive jacket; a "buzz-cut with a straight fringe" for a bowl cut |
| the pink-haired preset | no corset | **the corset**, lace on the sleeves; the hair "shaved on the sides" |
| sheet 2 | a long tunic for track pants | the track jacket's yellow panels, the striped track pants |
| sheets 1 and 4 | lengths made up | the afro and the camouflage cargo pants; the quiff, the piercings, the ripped jeans |
| Renata | no freckles | the freckles |

Each picture after the first: 10.7-10.9 s for a 2688×1520 sheet, 3.8-5.0 s for a portrait (Gemma: about 2 s); the
first, with the load, 17.2 s; 397-520 characters. Through the app (`POST /api/describe`), sheet 3 comes back with the
same "muscular build". A take of that sheet through the app (b7ce9741, 13 s at 480p, 16 min 37 s, described by hand as
a bodybuilder before this change): in eight frames across the 13 s he keeps his build, the bowl cut, the cropped polo
and the olive jacket, through the turn and the lean into the camera.

### The character's body from the picture, and where a long take loses the ending (2026-11-02)

With sheet 3's bodybuilder, Mike saw two things in the 13 s takes: the character came out thinner with Qwen's words
("muscular build") than with a hand-written "massive, extremely muscular bodybuilder build", and in the last second,
where the performer leans into the camera for a close-up of her face, neither take followed her: one stepped back to
full body (its description named his boots), the other stayed at mid-shot and grew red blots for hands where her face
had been. The prompt asked to keep "the proportions of everything" and copied from the picture only "face, hair and
clothing", not the body. A/B on the clip's last 5 s (8-13 s, 480p, the same description and seed 1568899394, through
the app):

| Prompt | His build | The close-up at the end |
|---|---|---|
| A: *…keeping that person's gestures and poses and the proportions of everything… Keep the reference character's face, hair and clothing. Preserve the scene and the audio timing.* (390f9090) | muscular | followed, his face fills the frame; no blots |
| B: *…keeping that person's gestures, poses and movement… The character's face, hair, skin, body build and clothing stay exactly as in `<Picture 1>` in every frame. Preserve the scene, the camera framing and the audio timing.* (29db9652) | the same | the same |

So the ending is lost by the long take, not by the prompt: in 13 s it falls in the third window, which carries on
from the second at the size the character had there. And the build follows the description's words, not the
prompt's: only "massive, extremely muscular" drew him as big as his picture. B stays, since it asks for the picture as
it is and no longer for the performer's proportions. The describer now names the haircut and no longer says where the
trousers end (Qwen had written "falling to the ankles"); it still calls this bowl cut a "buzz cut" and this build
"muscular", so a character this far from average is worth a word in the description box.

## The character creator on one model (2026-11-02)

The creator makes the head, then the full body around that head (`workflows/character-head.api.json` and
`workflows/character-body.api.json`). The question was whether Qwen-Image 2.1 Turbo alone could do both, generating and
editing with the same 7.3 GB file as in its official templates, or whether the body needs Qwen-Image-Edit 2511 with
Lightning, as in atelier. `scripts/creator-bench.py` ran both on two subjects, seed 20261103, on the RTX A4000:
- a person, described as the creator's buttons write her;
- an anthropomorphic black sheep in the 3D-animated style, the mascot case.

| Step | Qwen-Image 2.1 Turbo, 8 steps | 2511 Q4_K_S + Lightning, 8 steps (atelier) |
| --- | --- | --- |
| Four heads, 1024², one batch | 40.8 s (person, includes loading), 32.9 s (sheep) | — |
| Body around the first head, 1024×1792 | 23.4 s (person), 22.6 s (sheep) | 84.0 s (person), 72.0 s (sheep) |

What the pictures show (`hoja.jpg` and `caras-de-cerca.jpg` in the measurements folder):
- **Identity.** 2.1 keeps the head's face in the body: the same features, freckles and hair. 2511 draws a similar face,
  which is why atelier pastes the designed face back with FaceWarp.
- **The sheep.** 2.1 gives it black, hoof-like hands. 2511 gives it human hands.
- **Clothes.** Both follow the description.

2.1 Turbo also takes about a third of 2511's time. The creator uses Qwen-Image 2.1 Turbo for both steps, and no face
paste:
- **Downloads.** A user adds the 7.3 GB model and its 0.7 GB VAE. Its text encoder is the swap's describer, Qwen3-VL 8B,
  which Xólotl already installs.
- **Licence.** Dropping FaceWarp also drops its insightface models, which are for non-commercial research only.

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

Known limits (from the workflow's authors and confirmed here): the clip should be one continuous shot with the person visible in the first frame; the original soundtrack is kept, not regenerated; in run 1 the final frame shows the hand merged with a vase that sat inside the expanded mask. With several people, SAM takes the one it is most sure of in the part's first frame, and where tracking is lost it may pick someone else: the prompt `person` asks SAM 3 Detect for a single detection a frame (no `:N`), so Select Person's *largest* chooses among one, and each recovered frame gets its own top-scoring person.

Reference point: Comfy's own Openjutsu app reports about 2 minutes for a 5 s part at 480p on a Comfy Developer Platform deployment (GPU not published), with a first-frame anchor made by GPT Image through Comfy Router. Xólotl runs the same character-swap graph without any closed model.

## Install scripts, checked 2026-11-01

- `scripts/install-nodes.sh` run against an empty ComfyUI root installed Xólotl's nodes, `h3_character_swap` at `0670e4f` and `Veda-on-ComfyUI` at `67e4eb5`; compared with the copies that ran every take in this document (`sha256sum` for Xólotl's, `diff -r` for the two packs): identical.
- Every file `scripts/install-models.sh` fetches was HEAD-checked on Hugging Face at its pinned revision (HTTP 200). Default set, about 44 GB: H3 ref2va int8 convrot 21.0 GB, Qwen3-VL text encoder 15.7 GB, video VAE int8 convrot 2.8 GB, audio VAE 0.6 GB, ref2v turbo 4-step LoRA 1.96 GB, SAM 3.1 1.75 GB, Veda R2VA predictor 0.28 GB, swap LoRA v1.5 0.16 GB. `--fp8` swaps in the fp8 H3 (21.0 GB) and the fp16 video VAE (5.2 GB). The int8 H3 in use was downloaded and checked against Hugging Face's sha256 (`9255f52b…`).
