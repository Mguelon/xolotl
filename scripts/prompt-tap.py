#!/usr/bin/env python3
"""Run in ComfyUI only the nodes of workflows/swap.api.json that write H3's prompt, and print the prompt they write.

    COMFYUI_URL=https://comfyui.local python3 scripts/prompt-tap.py <image in ComfyUI's input folder> [direction]

Opened in ComfyUI without the app, the workflow writes its prompt itself: Gemma 4 E2B describes the character picture
(<Picture 1>), Format Text puts the description after its tag and the direction after it, and Trim Text takes off the
space an empty direction leaves. This runs those nodes alone, with a Preview Any at the end, so the prompt can be read
without spending a take (seconds, not minutes). The app writes the same prompt in lib/swap.ts (swapPrompt).
"""
import json, sys
from pathlib import Path

from comfy_run import run, upstream

WORKFLOW = Path(__file__).resolve().parents[1] / "workflows" / "swap.api.json"


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    full = json.loads(WORKFLOW.read_text())
    link = full["801"]["inputs"]["prompt"]
    if not isinstance(link, list):
        raise SystemExit("the workflow's prompt is plain text, not written by its nodes")
    graph = {node: full[node] for node in upstream(full, link[0])}
    graph["9"]["inputs"]["image"] = sys.argv[1]
    if len(sys.argv) > 2:
        graph["direction"]["inputs"]["value"] = sys.argv[2]
    graph["tap"] = {"class_type": "PreviewAny", "inputs": {"source": link}}
    entry, seconds, wall, _, _ = run(graph)
    text = "".join(entry["outputs"]["tap"]["text"])
    print(f"nodes: {', '.join(sorted(graph))}\nComfyUI {seconds:.2f} s, total {wall:.2f} s, "
          f"{len(text)} characters\n---\n{text}\n---")


if __name__ == "__main__":
    main()
