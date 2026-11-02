#!/usr/bin/env python3
"""Run in ComfyUI only the nodes of workflows/swap.api.json that write H3's prompt, and print the prompt they write.

    COMFYUI_URL=https://comfyui.local python3 scripts/prompt-tap.py <image in ComfyUI's input folder> [direction]

Opened in ComfyUI without the app, the workflow writes its prompt itself: Gemma 4 E2B describes the character picture
(<Picture 1>), Format Text puts the description after its tag and the direction after it, and Trim Text takes off the
space an empty direction leaves. This runs those nodes alone, with a Preview Any at the end, so the prompt can be read
without spending a take (seconds, not minutes). The app writes the same prompt in lib/swap.ts (swapPrompt).
"""
import json, os, sys, time, urllib.request, uuid
from pathlib import Path

URL = os.environ.get("COMFYUI_URL", "https://comfyui.local").rstrip("/")
WORKFLOW = Path(__file__).resolve().parents[1] / "workflows" / "swap.api.json"


def call(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, headers={"content-type": "application/json"} if data else {})
    return json.load(urllib.request.urlopen(req, timeout=600))


def upstream(graph, node):
    """The node and every node it reads from."""
    seen, todo = set(), [node]
    while todo:
        current = todo.pop()
        if current not in seen:
            seen.add(current)
            todo += [v[0] for v in graph[current]["inputs"].values() if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str)]
    return seen


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
    start = time.perf_counter()
    queued = call("/prompt", {"prompt": graph, "client_id": str(uuid.uuid4())})
    if queued.get("node_errors"):
        raise SystemExit(json.dumps(queued["node_errors"])[:1500])
    pid = queued["prompt_id"]
    while not (entry := call(f"/history/{pid}").get(pid)) or entry.get("status", {}).get("completed") is None:
        time.sleep(0.5)
    msgs = {m[0]: m[1] for m in entry["status"].get("messages", [])}
    if "execution_success" not in msgs:
        raise SystemExit(json.dumps(entry["status"])[:2000])
    seconds = (msgs["execution_success"]["timestamp"] - msgs["execution_start"]["timestamp"]) / 1000
    text = "".join(entry["outputs"]["tap"]["text"])
    print(f"nodes: {', '.join(sorted(graph))}\nComfyUI {seconds:.2f} s, total {time.perf_counter() - start:.2f} s, "
          f"{len(text)} characters\n---\n{text}\n---")


if __name__ == "__main__":
    main()
