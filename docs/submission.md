# Submission notes — Open Source Higgsfield Challenge

Form: https://form.typeform.com/to/V1dSQrkS (closes Tue Nov 3, 2026, 9 am PT / 12 pm ET). Rules: https://comfy.org/open-source-higgsfield

| Field | Answer |
|---|---|
| Project name | Xólotl |
| One-line description (≤100 chars) | Swap the person in a video for a character from one image — on your own GPU, open weights only. |
| GitHub repo | https://github.com/Mguelon/xolotl |
| Demo video (<2 min) | (YouTube link) |
| Live link | none — Xólotl runs on your own GPU |
| Social post (#OpenSourceHiggsfield) | (link) |
| Which parts of ComfyUI did you use? | Comfy SDK, Comfy API (v2, through the official self-hosted proxy) |
| Generative models used | MiniMax H3 (ref2va, fp8 by Comfy-Org; optional Singularity v1.3 w4a8 merge), Akatz Labs character-swap LoRA v1.5, lightx2v turbo 8-step LoRA, SAM 3.1 (multiplex), Qwen3-VL text encoder (H3), H3 video/audio VAEs |
| Other tools or techniques | Akatz Labs' `h3_character_swap` node pack (GPL-3.0, installed by script at a pinned revision); SAM 3.1 person tracking + 64 px mask expansion; masked regeneration of only the person's tokens with the character image as H3 reference; measured on an RTX A4000 16 GB with weights streaming through ComfyUI's dynamic VRAM; twin before/after viewer; every take keeps its exact workflow JSON |
| Category | Open Weights Only · Built with MiniMax H3 bonus |
| Is your stack fully open? | Yes — no closed API model in the path (Comfy's reference app needs GPT Image for the first frame; Xólotl doesn't) |
| Agreements | repo public with MIT licence · lawful/SFW, bundled examples are generated people · feature with credit OK · only submission |

## Social post (draft)

> Xólotl: swap the person in a video for any character from one image — on your own GPU, with open weights only. MiniMax H3 + SAM 3.1 + Akatz's swap LoRA on your ComfyUI through the Comfy SDK. 5 s at 480p in ~9–12 min on a 16 GB card, nothing leaves your machine. Twin before/after view, every take keeps its workflow. #OpenSourceHiggsfield
> (video) · github.com/Mguelon/xolotl

## Demo (≤ 2 min) — what is in it

Built by `docs/demo/build.sh docs/demo/segments.tsv docs/demo/xolotl-demo.mp4` from real screen recordings (Playwright, 1920×1080) and title cards rendered from `public/demo/cards/`.

1. Title card — Xólotl, open weights only, nothing leaves your machine.
2. The take — the app on the LAN: pick the bundled example, the direction is filled in, press *Transform*; the job goes to ComfyUI and the status shows queue, elapsed time and GPU load.
3. Card 01 — a 5 s take at 480p is about nine to twelve minutes on a 16 GB card, and the app says so.
4. Card 02 + the twin view — a finished take, the divider dragged across, the original sound, a second take.
5. Card 03 — how it was built: browser → Next.js → Comfy SDK → comfy-api-proxy → ComfyUI; the SAM 3.1 → mask → H3 graph.
6. ComfyUI — the exact workflow a take ran, opened from *Open in ComfyUI*, panned from the loaders to the result.
7. Card — install, then check: the real `npm run doctor` output.
8. Card 04 — measured on an RTX A4000 16 GB, fully open stack, repo.
