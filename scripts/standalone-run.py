#!/usr/bin/env python3
"""Runs workflows/xolotl.api.json, the workflow for ComfyUI without the app, end to end as someone would from the
editor: their clip in Load Video, their picture in Load Image, the seconds to use, queue.

    COMFYUI_URL=https://comfyui.local python3 scripts/standalone-run.py <clip> <picture> [seconds]

<clip> and <picture> are local files; they go into xolotl-medidas/ of ComfyUI's input folder first. Nothing else in
the workflow changes, except a Preview Any added on the prompt its nodes write, so the run shows what H3 was told.
Prints ComfyUI's time, that prompt and where ComfyUI saved the result; then how long each node that ran took, longest
first (a node another node expanded into is shown inside the graph's node it came from), their sum against ComfyUI's
time, the graph's nodes that neither ran nor came back cached, and the cached ones. The same goes as JSON to
STANDALONE_OUT (default _descargas/mediciones-h3-swap/medidas/sin-app/tiempos-por-nodo.json). Run it in the background.
"""
import json, os, sys
from datetime import datetime
from pathlib import Path

from comfy_run import run, upload

WORKFLOW = Path(__file__).resolve().parents[1] / "workflows" / "xolotl.api.json"
OUT = Path(os.environ.get("STANDALONE_OUT",
                          "/home/mike/comfyui/_descargas/mediciones-h3-swap/medidas/sin-app/tiempos-por-nodo.json"))


def describe(graph, node):
    """A node's class and title. A node that another node expanded into (the parent's id and dotted parts) is not
    in the graph: no class, and the title says which of the graph's nodes it came from."""
    if node in graph:
        return graph[node]["class_type"], graph[node].get("_meta", {}).get("title", "")
    top = node.split(".")[0]
    return None, f"inside {top}: {graph.get(top, {}).get('_meta', {}).get('title', '')}"


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
    graph["tap"] = {"class_type": "PreviewAny", "inputs": {"source": graph["801"]["inputs"]["prompt"]},
                    "_meta": {"title": "The prompt H3 was told (added by this script)"}}
    entry, seconds, _, cached, times = run(graph)
    saved = [f"{f.get('subfolder', '')}/{f['filename']}" for out in entry["outputs"].get("809", {}).values()
             if isinstance(out, list) for f in out if isinstance(f, dict) and "filename" in f]
    print(f"inputs: {loaded}, {graph['seconds']['inputs']['value']} s\nComfyUI {seconds / 60:.1f} min ({seconds:.1f} s)\n"
          f"prompt: {''.join(entry['outputs']['tap']['text'])}\nsaved: {saved}")

    rows = sorted(({"node": node, "class_type": kind, "title": title, "seconds": round(s, 3), "order": i}
                   for i, (node, s) in enumerate(times.items(), 1) for kind, title in [describe(graph, node)]),
                  key=lambda row: -row["seconds"])
    expanded = {}  # a graph node that expanded into others: its own time and theirs
    for node in times:
        if node not in graph:
            top = node.split(".")[0]
            expanded[top] = expanded.get(top, times.get(top, 0)) + times[node]
    total = sum(times.values())
    dead = [node for node in graph if node not in times and node not in cached] if times else None
    if rows:
        wide, wide_kind = max(len(r["node"]) for r in rows) + 2, max(len(r["class_type"] or "-") for r in rows) + 2
        print(f"\n{'seconds':>8}  {'node':<{wide}}{'class_type':<{wide_kind}}title")
        for r in rows:
            print(f"{r['seconds']:8.1f}  {r['node']:<{wide}}{r['class_type'] or '-':<{wide_kind}}{r['title']}")
    else:
        print("\nno time per node: the websocket said nothing (see above)")
    for top, s in expanded.items():
        print(f"{top} ({graph[top]['class_type']}) with the nodes it expanded into: {s:.1f} s")
    print(f"sum of the {len(rows)} nodes {total:.1f} s; ComfyUI, execution_start to execution_success, {seconds:.1f} s "
          f"({seconds - total:.1f} s outside the nodes)")
    if dead is not None:
        print(f"dead, neither run nor cached ({len(dead)}):")
        for node in dead:
            print(f"  {node:<10}{graph[node]['class_type']:<32}{graph[node].get('_meta', {}).get('title', '')}")
    print(f"cached ({len(cached)}): {', '.join(cached) or 'none'}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "measured": datetime.now().astimezone().isoformat(timespec="seconds"), "prompt_id": entry["prompt"][1],
        "clip": str(clip), "picture": str(picture), "inputs": loaded, "clip_seconds": graph["seconds"]["inputs"]["value"],
        "saved": saved, "comfyui_seconds": round(seconds, 3), "sum_of_nodes_seconds": round(total, 3),
        "nodes": rows, "expanded": {top: round(s, 3) for top, s in expanded.items()},
        "dead": None if dead is None else [{"node": n, "class_type": graph[n]["class_type"],
                                            "title": graph[n].get("_meta", {}).get("title", "")} for n in dead],
        "cached": cached}, ensure_ascii=False, indent=1) + "\n")
    print(f"written: {OUT}")


if __name__ == "__main__":
    main()
