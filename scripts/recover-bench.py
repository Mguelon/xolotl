#!/usr/bin/env python3
"""Times the search for the person on the frames where SAM's tracking lost them, the pack's Recover Empty Frames
(SAM made ready again for every frame) against Xólotl's Find the Person on Empty Frames (once a batch), on a stored
take's first pass, and checks that both give the same masks.

    COMFYUI_URL=https://comfyui.local python3 scripts/recover-bench.py <take-id-prefix> [label]

The take's clip (data/takes/<id>/clip.mp4) goes into ComfyUI's input folder under the name its workflow reads, as
the app had uploaded it. Each run keeps only what the first pass's masks need (the clip on the canvas, SAM's tracking, the recovery) and saves
the recovered masks as PNG frames, lossless for SAM's 0/1 masks, in xolotl-medidas/recover/ of ComfyUI's output
folder. The runs go pack, Xólotl, pack, Xólotl: ComfyUI keeps the tracking from one run to the next, so from the
second run on a run is the recovery and the saving alone. The masks are read back from that folder (COMFYUI_OUTPUT,
by default ~/comfyui/output) and compared pixel for pixel, and both reports (empty and recovered frames) must match.
Prints one line per run and the comparison, and appends them to RECOVER_OUT
(default _descargas/mediciones-h3-swap/medidas/recuperacion/runs.jsonl). Run it in the background.
"""
import json, os, sys, time
from pathlib import Path

import numpy as np
from PIL import Image

from comfy_run import run, upload, upstream

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get("COMFYUI_OUTPUT", Path.home() / "comfyui" / "output"))
OUT = Path(os.environ.get("RECOVER_OUT", "/home/mike/comfyui/_descargas/mediciones-h3-swap/medidas/recuperacion/runs.jsonl"))
VARIANTS = {"pack": "H3CharacterSwapRecoverMasks", "xolotl": "XolotlRecoverMasks"}
ORDER = ["pack", "xolotl", "pack", "xolotl"]
NODE = "107a"  # the first pass's recovery in workflows/swap.api.json


def graph(workflow, variant, prefix):
    nodes = {node: json.loads(json.dumps(workflow[node])) for node in upstream(workflow, NODE)}
    nodes[NODE]["class_type"] = VARIANTS[variant]
    nodes["see"] = {"class_type": "MaskToImage", "inputs": {"mask": [NODE, 0]}}
    nodes["save"] = {"class_type": "SaveImage", "inputs": {"images": ["see", 0], "filename_prefix": prefix}}
    nodes["report"] = {"class_type": "PreviewAny", "inputs": {"source": [NODE, 1]}}
    return nodes


def masks(entry):
    files = entry["outputs"]["save"]["images"]
    return np.stack([np.asarray(Image.open(OUTPUT / f["subfolder"] / f["filename"]))[..., 0] for f in files])


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    takes = ROOT / "data" / "takes"
    found = [d for d in takes.iterdir() if d.name.startswith(sys.argv[1])]
    if len(found) != 1:
        raise SystemExit(f"{len(found)} takes start with {sys.argv[1]}")
    take = found[0]
    label = sys.argv[2] if len(sys.argv) > 2 else take.name[:8]
    workflow = json.loads((take / "workflow.json").read_text())
    # The app clears its uploads after a take; the take keeps its clip, which goes back under the workflow's name.
    for node in upstream(workflow, NODE):
        if workflow[node]["class_type"] == "LoadVideo":
            upload(take / "clip.mp4", workflow[node]["inputs"]["file"])
    runs, kept = [], {}
    for i, variant in enumerate(ORDER, 1):
        entry, seconds, wall, cached = run(graph(workflow, variant, f"xolotl-medidas/recover/{label}_{variant}_{i}"))
        report = json.loads("".join(entry["outputs"]["report"]["text"]))
        frames = masks(entry)
        kept.setdefault(variant, []).append((frames, report))
        row = {"run": i, "variant": variant, "comfyui_s": round(seconds, 2), "wall_s": round(wall, 2),
               "tracking_reused": "105a" in cached, "empty": len(report["empty_tracking_frames"]),
               "recovered": len(report["recovered_frames"]), "frames": len(frames)}
        runs.append(row)
        print(f"{i} {variant}: ComfyUI {seconds:.1f} s{' (tracking reused)' if row['tracking_reused'] else ''}, "
              f"{row['recovered']} of {row['empty']} empty frames recovered, {len(frames)} masks", flush=True)
    base, base_report = kept["pack"][0]
    same = {}
    for variant, results in kept.items():
        for n, (frames, report) in enumerate(results):
            key = f"{variant}{n + 1}"
            differ = frames != base if frames.shape == base.shape else None
            same[key] = {"shape": list(frames.shape), "levels": len(np.unique(frames)), "report_same": report == base_report,
                         "pixels_differing": None if differ is None else int(differ.sum()),
                         "frames_differing": None if differ is None else int(differ.any(axis=(1, 2)).sum())}
    pack_s = [r["comfyui_s"] for r in runs if r["variant"] == "pack" and r["tracking_reused"]]
    xolotl_s = [r["comfyui_s"] for r in runs if r["variant"] == "xolotl" and r["tracking_reused"]]
    result = {"take": take.name, "label": label, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "runs": runs,
              "against_first_pack_run": same, "pack_s_tracking_reused": pack_s, "xolotl_s_tracking_reused": xolotl_s}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("a") as f:
        f.write(json.dumps(result) + "\n")
    print(json.dumps(same))
    if pack_s and xolotl_s:
        print(f"recovery and saving, tracking reused: pack {min(pack_s):.1f} s, Xólotl {min(xolotl_s):.1f} s")


if __name__ == "__main__":
    main()
