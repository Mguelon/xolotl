"""Runs a graph on ComfyUI and waits for it, for the measuring scripts next to this file (prompt-tap.py,
describe-bench.py, recover-bench.py). COMFYUI_URL says where ComfyUI is; through the waker that lends the GPU it is
https://comfyui.local, the default.
"""
import json
import os
import time
import urllib.request
import uuid
from pathlib import Path

URL = os.environ.get("COMFYUI_URL", "https://comfyui.local").rstrip("/")


def call(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, headers={"content-type": "application/json"} if data else {})
    return json.load(urllib.request.urlopen(req, timeout=600))


def upload(path, name, subfolder=""):
    """Puts a file in ComfyUI's input folder under that name, replacing one there, as the editor's upload does."""
    boundary = uuid.uuid4().hex
    fields = (("overwrite", "true"), ("type", "input"), ("subfolder", subfolder))
    body = b"".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields)
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
             "Content-Type: application/octet-stream\r\n\r\n").encode() + Path(path).read_bytes()
    body += f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(URL + "/upload/image", data=body,
                                 headers={"content-type": f"multipart/form-data; boundary={boundary}"})
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


def run(graph):
    """Queues the graph and waits for its end. Returns its /history entry, ComfyUI's own duration
    (execution_start to execution_success, in seconds), the time it took from here, and the nodes ComfyUI did not
    run again because it kept their outputs from the run before."""
    start = time.perf_counter()
    queued = call("/prompt", {"prompt": graph, "client_id": str(uuid.uuid4())})
    if queued.get("node_errors"):
        raise SystemExit(json.dumps(queued["node_errors"])[:1500])
    pid = queued["prompt_id"]
    while not (entry := call(f"/history/{pid}").get(pid)) or entry.get("status", {}).get("completed") is None:
        time.sleep(0.25)
    wall = time.perf_counter() - start
    msgs = {m[0]: m[1] for m in entry["status"].get("messages", [])}
    if "execution_success" not in msgs:
        raise SystemExit(json.dumps(entry["status"])[:2000])
    seconds = (msgs["execution_success"]["timestamp"] - msgs["execution_start"]["timestamp"]) / 1000
    return entry, seconds, wall, msgs.get("execution_cached", {}).get("nodes", [])
