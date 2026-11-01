# Xólotl

**Swap the person in a video for the character in one image — on your own GPU, with open weights only. Nothing leaves your machine.**

![Xólotl: the twin view, original on the left and the swapped character on the right](docs/xolotl.png)

Xólotl is a small web app in front of your ComfyUI. Drop a 5–15 s clip and one picture of a character, press *Transform*, and the person in the clip becomes that character while the performance, the scene, the camera and the original sound stay exactly as they were. It runs the character-swap graph that Comfy's own *Openjutsu* uses — MiniMax H3 with Akatz Labs' character-swap LoRA and SAM 3.1 — but entirely on a 16 GB consumer card, through Comfy's official SDK and API proxy, with no accounts, credits or closed models anywhere in the path.

Built for Comfy's [Open Source Higgsfield Challenge](https://comfy.org/open-source-higgsfield) (the *Openjutsu* prompt). Named after Xólotl, the Mexica god of lightning and transformation, the twin who could take any form.

## What you get

- **The twin view.** Original and swap in one frame with a divider you drag; both videos play in step, so you judge the identity, the scene and the timing in a single look.
- **Takes.** Every finished swap stays on disk with its character, its settings and the exact workflow JSON that ran — download the video, or the workflow together with its clip and character (named as the workflow expects them) to run the same graph in ComfyUI yourself.
- **Honest status.** Queue position, elapsed time and live GPU load while it runs (no invented percentages — the API proxy does not relay per-node progress); *Stop* cancels the take through the same API; a reload, or another browser on the LAN, picks a running take up again from the strip. A health pill tells you up front if a node or a model is missing (`npm run doctor` does the same from the terminal).
- **Two bundled takes** made with open models (a clip from MiniMax H3, characters from Qwen-Image), so the first run needs no upload.
- English and Spanish interface.

## Measured on an RTX A4000 (16 GB)

| H3 weights | 5 s clip at 480p | VRAM peak | RAM used |
|---|---|---|---|
| `ref2va` fp8 (Comfy-Org, default) | **11 min 30 s** | 15.7 GB | +19 GB |
| Singularity v1.3 w4a8 (community merge, `--singularity`) | **8 min 55 s** | 15.7 GB | +5 GB |
| `ref2va` fp8, through the app (5.1 s, bundled *Amara* take) | **9 min 15 s** | 15.7 GB | — |

Same clip, same seed, equivalent result in the first two runs: identity stable across all 124 frames, scene and performance preserved, original audio kept. The third row is the app itself (SDK → proxy → ComfyUI) with the bundled example, timed by the app. Details, limits and how the time breaks down: [docs/measurements.md](docs/measurements.md).

## Requirements

- An NVIDIA GPU with 16 GB of VRAM or more, and 64 GB of system RAM for the default fp8 weights (32 GB is enough with the Singularity weights).
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 0.41 or newer (the MiniMax H3 and SAM 3.1 nodes are built in), reachable from this machine.
- Python 3.10+ (for the Comfy API proxy), Node.js 22+, `git`, and the Hugging Face CLI (`pip install -U huggingface_hub`) for the model downloads.
- About 46 GB of disk for the models.

## Install

```bash
git clone https://github.com/Mguelon/xolotl.git && cd xolotl
npm ci

# 1. The character-swap node pack (Akatz Labs, GPL-3.0), pinned to the revision this app was tested with
scripts/install-nodes.sh /path/to/ComfyUI

# 2. The models (~46 GB, open weights; read each model card's licence)
scripts/install-models.sh /path/to/ComfyUI            # add --singularity for the faster 11.8 GB merge

# 3. Restart ComfyUI so it loads the pack, then put the official Comfy API v2 proxy in front of it
pip install comfy-api-proxy
comfy-api-proxy run --comfyui http://127.0.0.1:8188 --port 8192

# 4. Point the app at the proxy and check everything
cp .env.example .env.local                             # COMFY_BASE_URL=http://127.0.0.1:8192
npm run doctor

# 5. Run
npm run dev                                            # http://localhost:3000
```

If ComfyUI runs in Docker, `custom_nodes/` and `models/` are usually bind mounts: pass the host paths to the scripts, or copy the pack in with `docker cp`. The proxy binds to loopback; keep it that way unless you add a bearer token.

To use the Singularity weights (or any other H3 build you have), set them by environment instead of editing the workflow:

```bash
XOLOTL_UNET=Minimax-h3_Singularity_ref2va_v1.3_Pruned_w4a8.safetensors npm run dev
# also: XOLOTL_TURBO_LORA, XOLOTL_SWAP_LORA
```

## How it works

```
browser ── Next.js route handlers ── @comfyorg/sdk ── comfy-api-proxy (Comfy API v2) ── your ComfyUI
                                        │
                                 workflows/swap.api.json
```

1. The browser uploads the clip and the character to the app (`POST /api/jobs`), together with the part to use (start, length), the quality (480p / 768p), a seed and an optional direction. The same endpoint also takes `steps` (1–100, default 8) and `turbo=off`, which drops the 8-step turbo LoRA and samples H3's full schedule as the official template does; the interface does not expose them yet.
2. `lib/swap.ts` fills the workflow template: the clip into `LoadVideo`, the character into `LoadImage`, the part into the `Video Slice` and `PrepareVideo` nodes, the prompt and seed into the swap settings. The SDK uploads the files as assets and submits the graph to the proxy, which runs it on ComfyUI.
3. In the graph, SAM 3.1 finds the person in the first frame and tracks them through the clip; the mask is expanded by 64 px; MiniMax H3 (`ref2va`) regenerates only the masked tokens with the character image as reference, the character-swap LoRA v1.5 and the 8-step turbo LoRA, in one 124-frame window; the result is decoded and saved as MP4 with the source audio.
4. The app polls the job (`GET /api/jobs/:id`), shows the queue position, elapsed time and GPU load, and when the job succeeds stores the result next to the clip, the character and the workflow in `data/takes/<job id>/`.

The prompt always starts with the workflow's own instruction — *Replace the selected person in `<Video 1>` with the character in `<Picture 1>`. Preserve the source performance, scene and audio timing.* — and your direction is appended. Describing the character's face, hair, skin, build and outfit works much better than a generic "replace the person" (the authors of the workflow say the same, and our takes agree).

## Which parts of ComfyUI

Core ComfyUI nodes (MiniMax H3, SAM 3.1, video), Akatz Labs' `h3_character_swap` node pack, the **Comfy SDK** (`@comfyorg/sdk` 0.5.0, TypeScript) and the **Comfy API v2** served by the official self-hosted proxy (`comfy-api-proxy` 0.1.6). The same code runs unchanged against Comfy Cloud or a Developer Platform deployment: set `COMFY_BASE_URL` and `COMFY_API_KEY`.

## The stack is fully open

| Piece | Licence |
|---|---|
| MiniMax H3 `ref2va` weights, Qwen3-VL text encoder, video and audio VAEs ([Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3)) | MiniMax H3 Community License (its standard grant excludes some regions — read the card) |
| Character-swap LoRA v1.5 ([akatz-ai/MiniMax-H3-Character-Swap-LoRA](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA)) | MiniMax H3 Community License |
| Turbo 8-step LoRA ([lightx2v/Minimax-h3-Turbo](https://huggingface.co/lightx2v/Minimax-h3-Turbo)) | see model card |
| SAM 3.1 ([Comfy-Org/sam3.1](https://huggingface.co/Comfy-Org/sam3.1)) | see model card |
| `h3_character_swap` node pack ([akatz-labs/h3-character-swap-tool](https://github.com/akatz-labs/h3-character-swap-tool), installed by script, not vendored) | GPL-3.0 |
| The character-swap workflow (same repository) | MIT |
| `comfy-api-proxy`, `@comfyorg/sdk` | MIT |
| This app (derived from [Comfy-Org/comfy-openjutsu](https://github.com/Comfy-Org/comfy-openjutsu), MIT) | MIT |

No partner nodes, no closed API in the path. The first-frame "anchor" that Comfy's reference app makes with GPT Image is simply not needed here: the swap holds the identity on its own in our takes.

## Limits

One continuous shot, with the person visible in the first frame; with several people the largest one is swapped. Parts of 5 to 15 s; longer clips are trimmed to the part you choose. The original soundtrack is kept, not regenerated. Expect 9–12 min per 5 s at 480p on a 16 GB card (see the measurements).

## Credits

[Akatz Labs](https://github.com/akatz-labs) for the H3 character-swap workflow, LoRA and nodes; [Comfy Org](https://comfy.org) for ComfyUI, the SDK, the proxy and the Openjutsu reference app this one started from; MiniMax, Meta (SAM) and lightx2v for the models. Xólotl by Miguel Ángel López Carrizales (Matamoros, Tamaulipas, México), MIT.

---

**En español.** Xólotl cambia a la persona de un video por el personaje de una imagen, en tu propia GPU y solo con modelos abiertos: nada sale de tu máquina. La interfaz está en inglés y español; la instalación de arriba es la misma. Es la entrada al *Open Source Higgsfield Challenge* de Comfy (la idea «Openjutsu»).
