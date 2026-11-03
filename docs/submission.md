# Submission — Open Source Higgsfield Challenge

**Deadline: Tuesday, November 3, 2026, 9 am PT** (12 pm ET · 11 am in Mexico City). Form:
https://form.typeform.com/to/V1dSQrkS · Rules: https://comfy.org/open-source-higgsfield

The rules ask for the app's code under an open-source licence with setup instructions, and a demo that shows the work
in action and explains how it was built (for *Most Innovative*, also why it is new). Each entry competes in one main
category and one model-provider bonus; every entry is considered for *Best Overall*.

## Before sending

1. Upload `docs/demo/xolotl-demo.mp4` (1:56, 1920×1080) to YouTube, public or unlisted (title and description below),
   and copy the link.
2. Put that link in the README, in place of `DEMO_URL`, and commit:
   ```bash
   cd /mnt/ssd/proyectos/xolotl
   sed -i 's#(DEMO_URL)#(https://youtu.be/XXXXXXXXXXX)#' README.md && git commit -am "README: the demo's link"
   ```
3. Push the repo to GitHub, public, as `Mguelon/xolotl` (it is not there yet: `git ls-remote` asks for a login):
   ```bash
   git remote add github git@github.com:Mguelon/xolotl.git   # after creating the empty repo on github.com
   git push github main
   ```
4. Post on X (or LinkedIn) with the video and `#OpenSourceHiggsfield` (draft below) and copy the link.
5. Fill in the form with the answers below.

## The form

| Field | Answer |
|---|---|
| Project name | Xólotl |
| One-line description (≤100 chars) | Make a character, then cast it in any video — on your own GPU, open weights only. |
| GitHub repo | https://github.com/Mguelon/xolotl |
| Demo video (<2 min) | (the YouTube link) |
| Live link | None: Xólotl runs on your own GPU, in front of your own ComfyUI. Setup: README → Install. |
| Social post (#OpenSourceHiggsfield) | (the post's link) |
| Which parts of ComfyUI did you use? | The Comfy SDK (`@comfyorg/sdk`, TypeScript) against the Comfy API v2, through Comfy's official self-hosted `comfy-api-proxy`; every step is an API-format ComfyUI workflow in `workflows/`; core nodes (MiniMax H3, SAM 3.1, FLUX.2, video, *Generate Text*); eleven nodes of our own (MIT). |
| Generative models used | Swap: MiniMax H3 ref2va (Comfy-Org int8 convrot), Akatz Labs character-swap LoRA v1.5, lightx2v ref2v turbo 4-step LoRA v0.1, the Veda R2VA sparse-attention predictor, H3's Qwen3-VL text encoder and its video and audio VAEs, SAM 3.1 multiplex. Describer: Qwen3-VL 8B. Creator: FLUX.2 [klein] 4B (Apache 2.0) with Qwen3 4B and the FLUX.2 VAE. |
| Other tools or techniques | Eleven ComfyUI nodes of our own: the whole clip goes on the model's canvas uncropped; a crop frames the person so the model's pixels go to them (tracked once, masks carried onto the crop); the person's mask grows 8× faster than with the pack's node; the first window's repeated VAE encode is skipped; lost tracking frames are recovered; the swap is laid back over the original frames at the clip's own size and aspect ratio; the character's face is cut and enlarged as a second reference; an optional grey mannequin keeps the performer's looks out; the simple sheet (front, back and face) is laid out for H3. Qwen3-VL writes what the character looks like into H3's prompt. Akatz Labs' `h3_character_swap` pack (GPL-3.0, installed by script at a pinned revision). Int8 weights on comfy-kitchen's kernels. Every take keeps its exact workflow JSON. Each recipe choice measured one change at a time on an RTX A4000 16 GB (docs/measurements.md). |
| Category | Open Weights Only · Built with MiniMax H3 bonus |
| Is your stack fully open? | Yes. Every model is open weights, no partner node and no closed API anywhere in the path (Comfy's reference app needs GPT Image for its first frame; Xólotl doesn't). |
| Why is it innovative? (if asked) | You make the character and cast it in a real clip in one open app, on one 16 GB GPU, with no account, credits or upload. The model's pixels go to the person: tracked once on the whole frame, swapped in a crop at their native resolution, and laid back over your own frames at the clip's size, so a 1080p vertical clip comes back 1080p vertical with only the person regenerated. The creator's sheet is built for the swap (the back a performer who turns needs, and the face drawn large from the front), and a vision model writes the character into H3's prompt, which keeps the performer's looks out. |
| Agreements | Repo public, MIT · lawful and SFW; the bundled people and the sheep are generated · featuring with credit OK · one submission |

## Social post (draft)

> I made a black sheep in a minute and cast her in a real video. 🐑🎬
>
> Xólotl: make a character, then swap her into any clip — on your own GPU, open weights only. FLUX.2 [klein] draws
> her, SAM 3.1 + MiniMax H3 put her in the shot, and the scene, the camera and the sound stay yours. No account, no
> credits, no upload.
>
> #OpenSourceHiggsfield · built on @ComfyUI
> (video) · github.com/Mguelon/xolotl

## YouTube

**Title:** Xólotl — make a character, then cast it in any video (open weights, your own GPU)

**Description:**
> Xólotl is an open web app in front of your ComfyUI. Create a character (FLUX.2 [klein] 4B: four heads, the body,
> changes in words, a sheet with the front, the back and the face), then swap it into a real clip: SAM 3.1 tracks the
> person, MiniMax H3 redraws only them, and the result comes back at your clip's own size with the original sound.
> Everything runs on one RTX A4000 16 GB; open weights only, no closed API.
>
> Code (MIT): https://github.com/Mguelon/xolotl
> Built for Comfy's Open Source Higgsfield Challenge (#OpenSourceHiggsfield, the Openjutsu prompt).

## Demo (under 2 min) — what is in it

Built by `docs/demo/build.sh docs/demo/segments.tsv docs/demo/xolotl-demo.mp4` from real screen recordings
(Playwright, 1920×1080, the compiled app on the LAN) and the title cards in `public/demo/cards/`, rendered to PNG.

1. Title — make a character, cast it in a real clip; the models.
2. 01 The creator — the landing page, then a black sheep from scratch: animal, 3D animated, wool; four heads, one
   picked; the body in a hoodie and jeans; «Make the hoodie bright red»; the sheet, named Lana.
3. 02 The swap — «Use in the swap»: Lana and her description on the swap page, the bundled terrace clip, *Transform*,
   and the status (stages, GPU, time left).
4. 03 The twin view — Lana's finished take: the divider dragged across, original and swap in step.
5. 04 How it was built — browser → Next.js → Comfy SDK → comfy-api-proxy → ComfyUI; the creator's and the swap's
   graphs; the exact workflow a take ran, open in ComfyUI.
6. 05 Why it is new.
7. 06 Measured on an RTX A4000 16 GB · Open Weights Only · Built with MiniMax H3 · MIT.
