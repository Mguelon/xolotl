#!/usr/bin/env python3
"""Measures the character creator's two first steps on one model before the app is wired to them.

The question: can Qwen-Image 2.1 Turbo alone (its official templates generate and edit with the same 7.3 GB file, eight
steps) make the heads and then the full body around a head, or does the body need Qwen-Image-Edit 2511 + Lightning as
atelier makes it (api/core/personaje.py, measured there 2026-10-13: the body in 92-133 s)? Two subjects: a person, as
the creator's buttons write her today, and an anthropomorphic black sheep (the mascot case: a character that walks on
two legs like the person in the clip it will replace).

For each subject: four heads with workflows/character-head.api.json, then the first head's full body with
workflows/character-body.api.json (2.1 Turbo editing, on a 1024×1792 canvas) and with atelier's grafo_2511 (2511 Q4_K_S +
Lightning 8 steps, same canvas, its own body prompts). Writes the pictures, a sheet of them side by side and bench.json
(prompts, seeds, ComfyUI seconds per run) to CREATOR_BENCH_OUT.
"""
import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comfy_run import run, upload  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get("CREATOR_BENCH_OUT", "/home/mike/comfyui/_descargas/mediciones-h3-swap/medidas/creador"))
COMFY_OUTPUT = Path(os.environ.get("COMFY_OUTPUT", "/home/mike/comfyui/output"))
SEED = int(os.environ.get("SEED", "20261103"))

spec = importlib.util.spec_from_file_location("personaje", "/mnt/ssd/proyectos/atelier/api/core/personaje.py")
assert spec and spec.loader, "atelier's api/core/personaje.py is where its body recipe lives"
atelier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(atelier)

REALISTA = ("Close-up portrait photograph of {desc}. Head and shoulders, facing the camera with a neutral relaxed "
            "expression. Plain light grey seamless studio background, soft even studio lighting, sharp focus, realistic "
            "skin texture, natural proportions, 85mm lens, high-resolution photo.")
ANIMADO = ("3D animated feature film character render, close-up portrait of {desc}. Head and shoulders, facing the camera "
           "with a friendly neutral expression. Stylized appealing proportions with a slightly larger head and big "
           "expressive eyes, smooth subsurface-scattering skin, soft studio lighting, plain light grey background, "
           "high-quality modern 3D animation render.")
BODY_21 = ("Full-body image of the same character as in <image1>: {desc}. Standing upright in a relaxed natural pose facing "
           "the viewer, arms resting at the sides, the whole figure visible from head to toe with space above the head and "
           "below the feet. Plain light grey seamless studio background, soft even studio lighting. Keep exactly the same "
           "face, head, hair, colors, art style and rendering as <image1>.")

SUBJECTS = {
    "persona": {
        "head": REALISTA.format(desc="an original, fictional 26-year-old woman of mixed East Asian and Latin American "
                                     "descent with long wavy black hair and freckles"),
        "body": ("an original, fictional 26-year-old woman of mixed East Asian and Latin American descent with long wavy "
                 "black hair and freckles, an average build, wearing casual everyday clothes: a plain t-shirt, jeans and "
                 "clean sneakers"),
        "atelier": atelier.PROMPT_CUERPO,
    },
    "oveja": {
        "head": ANIMADO.format(desc="an original, fictional anthropomorphic black sheep character with curly black wool, "
                                    "a friendly face, small curled horns and floppy ears"),
        "body": ("an original, fictional anthropomorphic black sheep with curly black wool, standing on two legs like a "
                 "person, with an average build, wearing a black hoodie, jeans and white sneakers"),
        "atelier": atelier.PROMPT_CUERPO_ESTILO,
    },
}


def saved(entry, node):
    return [COMFY_OUTPUT / f.get("subfolder", "") / f["filename"]
            for out in entry["outputs"].get(node, {}).values() if isinstance(out, list)
            for f in out if isinstance(f, dict) and "filename" in f]


def keep(paths, name):
    OUT.mkdir(parents=True, exist_ok=True)
    kept = []
    for i, path in enumerate(paths):
        dest = OUT / (f"{name}-{i + 1}.png" if len(paths) > 1 else f"{name}.png")
        shutil.copyfile(path, dest)
        kept.append(dest)
    return kept


def main():
    head_wf = json.loads((ROOT / "workflows/character-head.api.json").read_text())
    body_wf = json.loads((ROOT / "workflows/character-body.api.json").read_text())
    report = {"seed": SEED, "runs": []}
    heads = {}
    for name, subject in SUBJECTS.items():
        g = json.loads(json.dumps(head_wf))
        g["5"]["inputs"]["prompt"] = subject["head"]
        g["9"]["inputs"]["noise_seed"] = SEED
        g["13"]["inputs"]["filename_prefix"] = f"xolotl-medidas/creador/{name}-cabeza"
        entry, seconds, wall, *_ = run(g)
        heads[name] = keep(saved(entry, "13"), f"{name}-cabeza")
        report["runs"].append({"run": f"{name} · 4 cabezas · 2.1 Turbo", "seconds": round(seconds, 1), "wall": round(wall, 1),
                               "prompt": subject["head"]})
        print(f"{name}: 4 heads in {seconds:.1f} s", flush=True)

    for name, subject in SUBJECTS.items():
        upload(heads[name][0], f"creador-{name}-cabeza.png", "xolotl-medidas")
        g = json.loads(json.dumps(body_wf))
        g["20"]["inputs"]["image"] = f"xolotl-medidas/creador-{name}-cabeza.png"
        g["5"]["inputs"]["prompt"] = BODY_21.format(desc=subject["body"])
        g["9"]["inputs"]["noise_seed"] = SEED
        g["13"]["inputs"]["filename_prefix"] = f"xolotl-medidas/creador/{name}-cuerpo-21"
        entry, seconds, wall, *_ = run(g)
        keep(saved(entry, "13"), f"{name}-cuerpo-21")
        report["runs"].append({"run": f"{name} · cuerpo · 2.1 Turbo editando", "seconds": round(seconds, 1),
                               "wall": round(wall, 1), "prompt": g["5"]["inputs"]["prompt"]})
        print(f"{name}: body with 2.1 Turbo in {seconds:.1f} s", flush=True)

    for name, subject in SUBJECTS.items():
        prompt = subject["atelier"].format(desc=subject["body"])
        g = atelier.grafo_2511(f"xolotl-medidas/creador-{name}-cabeza.png", prompt, SEED,
                               f"xolotl-medidas/creador/{name}-cuerpo-2511", pasos=8, lienzo=atelier.CUERPO_TAM)
        save = next(k for k, n in g.items() if n["class_type"] == "SaveImage")
        entry, seconds, wall, *_ = run(g)
        keep(saved(entry, save), f"{name}-cuerpo-2511")
        report["runs"].append({"run": f"{name} · cuerpo · 2511 + Lightning (atelier)", "seconds": round(seconds, 1),
                               "wall": round(wall, 1), "prompt": prompt})
        print(f"{name}: body with 2511 in {seconds:.1f} s", flush=True)

    (OUT / "bench.json").write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
    sheet()


def sheet():
    """Each subject on a row: the four heads, the body by 2.1 Turbo and the body by 2511."""
    from PIL import Image, ImageDraw
    rows = []
    for name in SUBJECTS:
        heads = [Image.open(OUT / f"{name}-cabeza-{i}.png").convert("RGB").resize((256, 256)) for i in range(1, 5)]
        grid = Image.new("RGB", (512, 512))
        for i, im in enumerate(heads):
            grid.paste(im, ((i % 2) * 256, (i // 2) * 256))
        bodies = [Image.open(OUT / f"{name}-cuerpo-{m}.png").convert("RGB") for m in ("21", "2511")]
        bodies = [b.resize((round(b.width * 512 / b.height), 512)) for b in bodies]
        row = Image.new("RGB", (512 + sum(b.width for b in bodies) + 16, 512), (18, 22, 20))
        row.paste(grid, (0, 0))
        x = 520
        for label, body in zip(("2.1 Turbo", "2511"), bodies):
            row.paste(body, (x, 0))
            ImageDraw.Draw(row).text((x + 8, 8), label, fill=(240, 240, 230))
            x += body.width + 8
        rows.append(row)
    width = max(r.width for r in rows)
    out = Image.new("RGB", (width, sum(r.height for r in rows) + 8), (18, 22, 20))
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
