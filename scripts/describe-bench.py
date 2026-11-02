#!/usr/bin/env python3
"""Time and read the character descriptions a model writes, through ComfyUI as the app runs them.

    COMFYUI_URL=https://comfyui.local python3 scripts/describe-bench.py <model> <image> [image ...]

<model> is `gemma4-e2b`, the app's own workflow (workflows/describe.api.json: ComfyUI's Generate Text with
gemma4_e2b_it_int8_convrot), or `florence` (Kijai's Florence-2 node, more_detailed_caption: it takes no instruction).
Qwen3.5-0.8B and SmolVLM2-500M ran through a transformers loader node that left the pack when Gemma won (commit
5c658ec has it). The images are names in ComfyUI's input folder. The first image is timed cold (the model loads), the
rest warm. Prints one line per image and appends the run to DESCRIBE_OUT
(default _descargas/mediciones-h3-swap/medidas/descripciones/runs.jsonl). DESCRIBE_INSTRUCTION="..." tries other words
for Gemma than the workflow's, to compare instructions on the same pictures before changing the workflow;
DESCRIBE_THINKING=1 lets Gemma reason first (Generate Text's thinking mode) and DESCRIBE_MAX_LENGTH sets its token cap;
DESCRIBE_CLIP=<file in models/text_encoders> runs the same workflow with another vision-language model that ComfyUI's
loader knows (qwen3vl_4b_fp8_scaled.safetensors, say), DESCRIBE_CLIP_TYPE its loader type if it is not the default;
DESCRIBE_WORKFLOW=<file> runs another describe graph (its LoadImage "img", its answer in Preview Any "out"; any other
Preview Any is printed above it, a first step's list say).
"""
import json, os, sys, time, urllib.request, uuid
from pathlib import Path

URL = os.environ.get("COMFYUI_URL", "https://comfyui.local").rstrip("/")
OUT = Path(os.environ.get("DESCRIBE_OUT", "/home/mike/comfyui/_descargas/mediciones-h3-swap/medidas/descripciones/runs.jsonl"))
DESCRIBE = Path(__file__).resolve().parents[1] / "workflows" / "describe.api.json"


def instruction():
    return os.environ.get("DESCRIBE_INSTRUCTION") or json.loads(DESCRIBE.read_text())["gen"]["inputs"]["prompt"]


def graph(model, image):
    if model == "gemma4-e2b":
        workflow = json.loads(Path(os.environ.get("DESCRIBE_WORKFLOW") or DESCRIBE).read_text())
        workflow["img"]["inputs"]["image"] = image
        if os.environ.get("DESCRIBE_INSTRUCTION") or not os.environ.get("DESCRIBE_WORKFLOW"):
            workflow["gen"]["inputs"]["prompt"] = instruction()
        if os.environ.get("DESCRIBE_CLIP"):
            workflow["clip"]["inputs"]["clip_name"] = os.environ["DESCRIBE_CLIP"]
        if os.environ.get("DESCRIBE_CLIP_TYPE"):
            workflow["clip"]["inputs"]["type"] = os.environ["DESCRIBE_CLIP_TYPE"]
        if os.environ.get("DESCRIBE_THINKING"):
            workflow["gen"]["inputs"]["thinking"] = True
        if os.environ.get("DESCRIBE_MAX_LENGTH"):
            workflow["gen"]["inputs"]["max_length"] = int(os.environ["DESCRIBE_MAX_LENGTH"])
        return workflow
    if model == "florence":
        return {"img": {"class_type": "LoadImage", "inputs": {"image": image}},
                "m": {"class_type": "Florence2ModelLoader", "inputs": {"model": "Florence-2-large-ft", "precision": "fp16"}},
                "run": {"class_type": "Florence2Run", "inputs": {"image": ["img", 0], "florence2_model": ["m", 0], "text_input": "",
                        "task": "more_detailed_caption", "fill_mask": False, "keep_model_loaded": True, "max_new_tokens": 256,
                        "num_beams": 3, "do_sample": False, "output_mask_select": "", "seed": 1}},
                "out": {"class_type": "PreviewAny", "inputs": {"source": ["run", 2]}}}
    raise SystemExit(f"unknown model {model}: gemma4-e2b or florence")


def call(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, headers={"content-type": "application/json"} if data else {})
    return json.load(urllib.request.urlopen(req, timeout=600))


def run(model, image):
    start = time.perf_counter()
    queued = call("/prompt", {"prompt": graph(model, image), "client_id": str(uuid.uuid4())})
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
    outputs = entry["outputs"]
    steps = {n: " ".join(" ".join(t for t in o.get("text", []) if isinstance(t, str)).split()) for n, o in outputs.items() if n != "out"}
    for n, t in steps.items():
        if t:
            print(f"  [{n}] {t}")
    texts = [t for t in outputs.get("out", {}).get("text", []) if isinstance(t, str)] or [t for t in steps.values() if t]
    return seconds, wall, " ".join(" ".join(texts).split())


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    model, images = sys.argv[1], sys.argv[2:]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    for i, image in enumerate(images):
        seconds, wall, text = run(model, image)
        row = {"model": model, "image": image, "cold": i == 0, "comfyui_s": round(seconds, 2), "wall_s": round(wall, 2),
               "words": len(text.split()), "text": text, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        if model == "gemma4-e2b":
            row["instruction"] = instruction()
            row["thinking"] = bool(os.environ.get("DESCRIBE_THINKING"))
            row["clip"] = os.environ.get("DESCRIBE_CLIP") or "gemma4_e2b_it_int8_convrot.safetensors"
        with OUT.open("a") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"{model} {image}: ComfyUI {seconds:.2f} s, total {wall:.2f} s{' (con carga)' if i == 0 else ''}, {row['words']} palabras\n  {text}\n")
