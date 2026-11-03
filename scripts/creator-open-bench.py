#!/usr/bin/env python3
"""Measures the character creator on open-licence models, against the Qwen-Image 2.1 Turbo run of creator-bench.py.

Why: Qwen-Image 2.1, the Turbo too, is under the Qwen Research License: "for non-commercial purposes only" (research or
evaluation). A character for a business, such as a shop's mascot, is a commercial use. These models are Apache 2.0 and
are already on disk:
  heads   Z-Image Turbo (Tongyi-MAI; Qwen3 4B encoder, FLUX.1 VAE), 8 steps
          FLUX.2 [klein] 4B (Black Forest Labs; Qwen3 4B encoder, FLUX.2 VAE), 4 steps
  body    Qwen-Image-Edit 2511 Q4_K_S + Lightning 8 steps, atelier's body recipe (api/core/personaje.py)
  change  FLUX.2 [klein] 4B editing with the picture as a reference, on the same 1024×1792 canvas

For each subject of creator-bench.py (the person and the anthropomorphic black sheep), with the same prompts and seed:
  1. four heads with each text-to-image model;
  2. the body around the first Z-Image head with each editor;
  3. one change ("make the t-shirt / hoodie bright red") to each editor's own body.
Writes the pictures, bench.json (prompts, seeds, ComfyUI seconds) and hoja.jpg to CREATOR_OPEN_BENCH_OUT. The sheet
also shows the 2.1 Turbo heads and body from creator-bench.py's folder, for comparison.
"""
import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from comfy_run import run, upload  # noqa: E402

spec = importlib.util.spec_from_file_location("creator_bench", HERE / "creator-bench.py")
assert spec and spec.loader, "scripts/creator-bench.py holds the subjects this bench shares with the 2.1 run"
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)
atelier = bench.atelier

OUT = Path(os.environ.get("CREATOR_OPEN_BENCH_OUT", "/home/mike/comfyui/_descargas/mediciones-h3-swap/medidas/creador-abierto"))
BODY = (1024, 1792)
CHANGE = {"persona": "Make the t-shirt bright red", "oveja": "Make the hoodie bright red"}
STYLE = {"persona": "realista", "oveja": "caricatura"}


def keep(paths, name):
    OUT.mkdir(parents=True, exist_ok=True)
    kept = []
    for i, path in enumerate(paths):
        dest = OUT / (f"{name}-{i + 1}.png" if len(paths) > 1 else f"{name}.png")
        shutil.copyfile(path, dest)
        kept.append(dest)
    return kept


def save_node(graph):
    return next(k for k, n in graph.items() if n["class_type"] == "SaveImage")


def tall(graph):
    """klein's edit graph takes its canvas from the reference; the body and its change keep the body's canvas."""
    graph["8"]["inputs"].update(width=BODY[0], height=BODY[1])
    graph["10"]["inputs"].update(width=BODY[0], height=BODY[1])
    graph.pop("14", None)
    return graph


def measure(report, label, graph, name):
    entry, seconds, wall, *_ = run(graph)
    kept = keep(bench.saved(entry, save_node(graph)), name)
    prompt = next((n["inputs"].get("text") or n["inputs"].get("prompt") for n in graph.values()
                   if n["class_type"].startswith(("CLIPTextEncode", "TextEncode")) and
                   (n["inputs"].get("text") or n["inputs"].get("prompt"))), "")
    report["runs"].append({"run": label, "seconds": round(seconds, 1), "wall": round(wall, 1), "prompt": prompt})
    print(f"{label}: {seconds:.1f} s", flush=True)
    return kept


def main():
    report = {"seed": bench.SEED, "runs": []}
    seed = bench.SEED
    # One model at a time, so each is loaded once.
    for name, subject in bench.SUBJECTS.items():
        g = atelier.grafo_zimage(subject["head"], seed, f"xolotl-medidas/creador-abierto/{name}-z-cabeza")
        g["8"]["inputs"]["batch_size"] = 4
        measure(report, f"{name} · 4 cabezas · Z-Image Turbo", g, f"{name}-z-cabeza")
    for name, subject in bench.SUBJECTS.items():
        g = atelier.grafo_klein(subject["head"], seed, f"xolotl-medidas/creador-abierto/{name}-klein-cabeza")
        g["10"]["inputs"]["batch_size"] = 4
        measure(report, f"{name} · 4 cabezas · klein 4B", g, f"{name}-klein-cabeza")

    for name in bench.SUBJECTS:
        upload(OUT / f"{name}-z-cabeza-1.png", f"abierto-{name}-z-cabeza.png", "xolotl-medidas")

    for name, subject in bench.SUBJECTS.items():
        template = atelier.PROMPT_CUERPO if STYLE[name] == "realista" else atelier.PROMPT_CUERPO_ESTILO
        g = tall(atelier.grafo_klein_edit([f"xolotl-medidas/abierto-{name}-z-cabeza.png"], template.format(desc=subject["body"]),
                                          seed, f"xolotl-medidas/creador-abierto/{name}-cuerpo-klein"))
        body = measure(report, f"{name} · cuerpo · klein 4B editando", g, f"{name}-cuerpo-klein")[0]
        upload(body, f"abierto-{name}-cuerpo-klein.png", "xolotl-medidas")
        g = tall(atelier.grafo_klein_edit([f"xolotl-medidas/abierto-{name}-cuerpo-klein.png"],
                                          CHANGE[name] + "." + atelier.SOLO_ESO, seed,
                                          f"xolotl-medidas/creador-abierto/{name}-cambio-klein"))
        measure(report, f"{name} · cambio · klein 4B", g, f"{name}-cambio-klein")

    for name, subject in bench.SUBJECTS.items():
        g = atelier.grafo_cuerpo(f"xolotl-medidas/abierto-{name}-z-cabeza.png", subject["body"], seed,
                                 f"xolotl-medidas/creador-abierto/{name}-cuerpo-2511", estilo=STYLE[name])
        body = measure(report, f"{name} · cuerpo · 2511 + Lightning", g, f"{name}-cuerpo-2511")[0]
        upload(body, f"abierto-{name}-cuerpo-2511.png", "xolotl-medidas")
        g = atelier.grafo_edicion(f"xolotl-medidas/abierto-{name}-cuerpo-2511.png", CHANGE[name], seed,
                                  f"xolotl-medidas/creador-abierto/{name}-cambio-2511", lienzo=BODY)
        measure(report, f"{name} · cambio · 2511 + Lightning", g, f"{name}-cambio-2511")

    (OUT / "bench.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    sheet()


def sheet():
    """Each subject on a row: the heads of 2.1 Turbo, Z-Image and klein (two of each), then the bodies and changes."""
    from PIL import Image, ImageDraw
    old = bench.OUT
    rows = []
    for name in bench.SUBJECTS:
        cells = []
        for label, files in (("2.1 Turbo", [old / f"{name}-cabeza-{i}.png" for i in (1, 2)]),
                             ("Z-Image", [OUT / f"{name}-z-cabeza-{i}.png" for i in (1, 2)]),
                             ("klein 4B", [OUT / f"{name}-klein-cabeza-{i}.png" for i in (1, 2)])):
            pair = Image.new("RGB", (256, 512))
            for i, f in enumerate(files):
                pair.paste(Image.open(f).convert("RGB").resize((256, 256)), (0, i * 256))
            cells.append((label, pair))
        for label, f in (("2.1 cuerpo", old / f"{name}-cuerpo-21.png"), ("2511 cuerpo", OUT / f"{name}-cuerpo-2511.png"),
                         ("2511 cambio", OUT / f"{name}-cambio-2511.png"), ("klein cuerpo", OUT / f"{name}-cuerpo-klein.png"),
                         ("klein cambio", OUT / f"{name}-cambio-klein.png")):
            im = Image.open(f).convert("RGB")
            cells.append((label, im.resize((round(im.width * 512 / im.height), 512))))
        row = Image.new("RGB", (sum(c.width for _, c in cells) + 8 * len(cells), 512), (18, 22, 20))
        x = 0
        for label, cell in cells:
            row.paste(cell, (x, 0))
            ImageDraw.Draw(row).text((x + 8, 8), label, fill=(240, 240, 230))
            x += cell.width + 8
        rows.append(row)
    out = Image.new("RGB", (max(r.width for r in rows), sum(r.height for r in rows) + 8), (18, 22, 20))
    y = 0
    for r in rows:
        out.paste(r, (0, y))
        y += r.height + 8
    out.save(OUT / "hoja.jpg", quality=85)
    print(OUT / "hoja.jpg")


if __name__ == "__main__":
    if sys.argv[1:] == ["--hoja"]:
        sheet()
    else:
        main()
