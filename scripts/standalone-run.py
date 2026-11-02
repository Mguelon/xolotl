#!/usr/bin/env python3
"""Runs workflows/xolotl.api.json, the workflow for ComfyUI without the app, end to end as someone would from the
editor: their clip in Load Video, their picture in Load Image, the seconds to use, queue.

    COMFYUI_URL=https://comfyui.local python3 scripts/standalone-run.py <clip> <picture> [seconds]

<clip> and <picture> are local files; they go into xolotl-medidas/ of ComfyUI's input folder first. Nothing else in
the workflow changes, except a Preview Any added on the prompt its nodes write, so the run shows what H3 was told.
Prints ComfyUI's time, that prompt and where ComfyUI saved the result. Run it in the background.
"""
import json, sys
from pathlib import Path

from comfy_run import run, upload

WORKFLOW = Path(__file__).resolve().parents[1] / "workflows" / "xolotl.api.json"


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    clip, picture = Path(sys.argv[1]), Path(sys.argv[2])
    graph = json.loads(WORKFLOW.read_text())
    loaded = {}
    for path, node, field in ((clip, "30", "file"), (picture, "9", "image")):
        name = f"standalone-{path.name}"
        upload(path, name, "xolotl-medidas")
        graph[node]["inputs"][field] = loaded[node] = f"xolotl-medidas/{name}"
    if len(sys.argv) > 3:
        graph["seconds"]["inputs"]["value"] = float(sys.argv[3])
    graph["tap"] = {"class_type": "PreviewAny", "inputs": {"source": graph["801"]["inputs"]["prompt"]}}
    entry, seconds, _, _ = run(graph)
    saved = [f"{f.get('subfolder', '')}/{f['filename']}" for out in entry["outputs"].get("809", {}).values()
             if isinstance(out, list) for f in out if isinstance(f, dict) and "filename" in f]
    print(f"inputs: {loaded}, {graph['seconds']['inputs']['value']} s\nComfyUI {seconds / 60:.1f} min ({seconds:.1f} s)\n"
          f"prompt: {''.join(entry['outputs']['tap']['text'])}\nsaved: {saved}")


if __name__ == "__main__":
    main()
