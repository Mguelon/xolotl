#!/usr/bin/env python3
"""Time and read the character descriptions a model writes, through ComfyUI as the app runs them.

    COMFYUI_URL=https://comfyui.local python3 scripts/describe-bench.py <model> <image> [image ...] [--device cpu] [--max-side N]

<model> is a folder in models/LLM run by Xólotl's Describe the Character node (Qwen3.5-0.8B, SmolVLM2-500M-...),
`florence` (Kijai's Florence-2 node, more_detailed_caption: it takes no instruction) or `gemma4-e2b` (ComfyUI's own
Generate Text with gemma4_e2b_it_int8_convrot). The images are names in ComfyUI's input folder. The first image is
timed cold (the model loads), the rest warm. Prints one line per image and appends the run to
DESCRIBE_OUT (default _descargas/mediciones-h3-swap/medidas/descripciones/runs.jsonl).
"""
import ast, json, os, sys, time, urllib.request, uuid
from pathlib import Path

URL = os.environ.get("COMFYUI_URL", "https://comfyui.local").rstrip("/")
OUT = Path(os.environ.get("DESCRIBE_OUT", "/home/mike/comfyui/_descargas/mediciones-h3-swap/medidas/descripciones/runs.jsonl"))
# the same words the node uses, read without importing torch (the node's module runs inside ComfyUI)
_source = (Path(__file__).resolve().parents[1] / "comfy_nodes" / "xolotl" / "describe.py").read_text()
INSTRUCTION = next(ast.literal_eval(n.value) for n in ast.parse(_source).body
                   if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "INSTRUCTION")


def graph(model, image, device, max_side):
    load = {"class_type": "LoadImage", "inputs": {"image": image}}
    if model == "florence":
        return {"img": load,
                "m": {"class_type": "Florence2ModelLoader", "inputs": {"model": "Florence-2-large-ft", "precision": "fp16"}},
                "run": {"class_type": "Florence2Run", "inputs": {"image": ["img", 0], "florence2_model": ["m", 0], "text_input": "",
                        "task": "more_detailed_caption", "fill_mask": False, "keep_model_loaded": True, "max_new_tokens": 256,
                        "num_beams": 3, "do_sample": False, "output_mask_select": "", "seed": 1}},
                "out": {"class_type": "PreviewAny", "inputs": {"source": ["run", 2]}}}
    if model == "gemma4-e2b":
        return {"img": load,
                "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": "gemma4_e2b_it_int8_convrot.safetensors", "type": "stable_diffusion"}},
                "gen": {"class_type": "TextGenerate", "inputs": {"clip": ["clip", 0], "prompt": INSTRUCTION, "image": ["img", 0],
                        "max_length": 200, "sampling_mode": "off"}},
                "out": {"class_type": "PreviewAny", "inputs": {"source": ["gen", 0]}}}
    return {"img": load,
            "d": {"class_type": "XolotlDescribeCharacter", "inputs": {"image": ["img", 0], "model": model, "max_side": max_side,
                  "max_new_tokens": 200, "device": device}},
            "out": {"class_type": "PreviewAny", "inputs": {"source": ["d", 0]}}}


def call(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, headers={"content-type": "application/json"} if data else {})
    return json.load(urllib.request.urlopen(req, timeout=600))


def run(model, image, device, max_side):
    start = time.perf_counter()
    queued = call("/prompt", {"prompt": graph(model, image, device, max_side), "client_id": str(uuid.uuid4())})
    if queued.get("node_errors"):
        raise SystemExit(json.dumps(queued["node_errors"])[:1500])
    pid = queued["prompt_id"]
    while True:
        entry = call(f"/history/{pid}").get(pid)
        if entry and entry.get("status", {}).get("completed") is not None:
            break
        time.sleep(0.25)
    wall = time.perf_counter() - start
    msgs = {m[0]: m[1] for m in entry["status"].get("messages", [])}
    if "execution_success" not in msgs:
        raise SystemExit(json.dumps(entry["status"])[:2000])
    seconds = (msgs["execution_success"]["timestamp"] - msgs["execution_start"]["timestamp"]) / 1000
    texts = [t for o in entry["outputs"].values() for t in o.get("text", []) if isinstance(t, str)]
    return seconds, wall, " ".join(" ".join(texts).split())


if __name__ == "__main__":
    args = sys.argv[1:]
    device = args[args.index("--device") + 1] if "--device" in args else "gpu"
    max_side = int(args[args.index("--max-side") + 1]) if "--max-side" in args else 1024
    names = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] not in ("--device", "--max-side"))]
    model, images = names[0], names[1:]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    for i, image in enumerate(images):
        seconds, wall, text = run(model, image, device, max_side)
        row = {"model": model, "device": device, "max_side": max_side, "image": image, "cold": i == 0,
               "comfyui_s": round(seconds, 2), "wall_s": round(wall, 2), "words": len(text.split()), "text": text,
               "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        with OUT.open("a") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"{model} {device} {image}: ComfyUI {seconds:.2f} s, total {wall:.2f} s{' (con carga)' if i == 0 else ''}, {row['words']} palabras\n  {text}\n")
