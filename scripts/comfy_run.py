"""Runs a graph on ComfyUI and waits for it, for the measuring scripts next to this file (prompt-tap.py,
describe-bench.py, recover-bench.py, standalone-run.py). COMFYUI_URL says where ComfyUI is; through the waker that
lends the GPU it is https://comfyui.local, the default. While the graph runs it listens on ComfyUI's websocket, which
says when each node starts, to time the nodes one by one; without the websocket the run is only timed as a whole.
"""
import contextlib
import json
import os
import sys
import time
import urllib.request
import uuid
from pathlib import Path

try:
    from websockets.sync.client import connect
except ImportError:
    connect = None

URL = os.environ.get("COMFYUI_URL", "https://comfyui.local").rstrip("/")
ENDS = ("execution_success", "execution_error", "execution_interrupted")


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


def listen(client_id):
    """ComfyUI's websocket as that client, opened before its prompt is queued: ComfyUI says which node is running
    only to the client that queued the prompt. None, saying why, if it does not open."""
    if connect is None:
        print("no websockets package: no time per node", file=sys.stderr)
        return None
    try:
        return connect(f"ws{URL[4:]}/ws?clientId={client_id}", max_size=None, open_timeout=600, ping_timeout=None)
    except Exception as e:
        print(f"ComfyUI's websocket did not open ({e!r}): no time per node", file=sys.stderr)
        return None


def follow(ws, pid):
    """Reads ComfyUI's messages about that prompt until it ends. Returns the seconds each node that ran took, by
    node id in the order they ran, from its `executing` message to the next one (the last node's to the prompt's
    end), and the nodes ComfyUI said it had cached. Previews (binary messages) and other prompts' messages are
    skipped. If the socket drops, or stays quiet while /history shows the prompt over, it says so and keeps the
    nodes it timed until then."""
    marks, cached = [], []
    try:
        while not marks or marks[-1][0] is not None:
            try:
                message = ws.recv(timeout=10)
            except TimeoutError:
                if (call(f"/history/{pid}").get(pid) or {}).get("status", {}).get("completed") is not None:
                    raise ConnectionError("the prompt ended without a word on the websocket")
                continue
            now = time.perf_counter()
            event = json.loads(message) if isinstance(message, str) else {}
            data, kind = event.get("data"), event.get("type")
            if not isinstance(data, dict) or data.get("prompt_id") != pid:
                continue
            if kind == "execution_cached":
                cached = data.get("nodes", [])
            elif kind == "executing" or kind in ENDS:
                marks.append((data.get("node") if kind == "executing" else None, now))
    except Exception as e:
        running = marks[-1][0] if marks else None
        print(f"ComfyUI's websocket was lost during the run ({e!r}); the time per node stops at node {running}",
              file=sys.stderr)
    times = {}
    for (node, began), (_, ended) in zip(marks, marks[1:]):
        times[node] = times.get(node, 0) + ended - began
    return times, cached


def run(graph):
    """Queues the graph and waits for its end. Returns its /history entry, ComfyUI's own duration
    (execution_start to execution_success, in seconds), the time it took from here, the nodes ComfyUI did not
    run again because it kept their outputs from the run before, and the seconds each node that ran took, by node
    id in the order they ran (empty without the websocket)."""
    start = time.perf_counter()
    client_id = str(uuid.uuid4())
    ws = listen(client_id)
    times, cached = {}, []
    with ws if ws is not None else contextlib.nullcontext():
        queued = call("/prompt", {"prompt": graph, "client_id": client_id})
        if queued.get("node_errors"):
            raise SystemExit(json.dumps(queued["node_errors"])[:1500])
        pid = queued["prompt_id"]
        if ws is not None:
            times, cached = follow(ws, pid)
    while not (entry := call(f"/history/{pid}").get(pid)) or entry.get("status", {}).get("completed") is None:
        time.sleep(0.25)
    wall = time.perf_counter() - start
    msgs = {m[0]: m[1] for m in entry["status"].get("messages", [])}
    if "execution_success" not in msgs:
        raise SystemExit(json.dumps(entry["status"])[:2000])
    seconds = (msgs["execution_success"]["timestamp"] - msgs["execution_start"]["timestamp"]) / 1000
    return entry, seconds, wall, msgs.get("execution_cached", {}).get("nodes", cached), times
