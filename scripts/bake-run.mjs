#!/usr/bin/env node
// Queue ONE measured run on the local ComfyUI from a stored take's workflow, with explicit edits, and record it.
//
//   node scripts/bake-run.mjs --take <take-id-prefix> --label <label> [--set <node>.<field>=<value> ...]
//        [--insert '{"id":"40","class_type":"X","on":["850",0],"input":"model","inputs":{...}}' ...] [--dry] [--wait]
//
// --insert puts a new node on a wire: it reads `on` through `input`, and every node that read `on` reads the new
// node instead. --dry prints the edits and the rewired consumers without queuing anything.
//
// The SaveVideo prefix becomes xolotl/bake_<label>. Every run is appended to docs/demo/build/bake-off.json
// ({ base, runs: [{ label, prompt_id, take, edits, queued_at, outcome?, seconds?, outputs? }] }).
// With --wait the script keeps ComfyUI's websocket open under the client_id it submitted with (per-prompt events
// only reach that client), exits when the run ends and prints the exact duration from /history
// (execution_start → execution_success). Run it in the background; never sit on it.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const COMFYUI = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const ROOT = new URL("..", import.meta.url).pathname;
const TAKES = join(ROOT, "data/takes");
const RECORD = join(ROOT, "docs/demo/build/bake-off.json");

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sets = args.flatMap((a, i) => (a === "--set" ? [args[i + 1]] : []));
const inserts = args.flatMap((a, i) => (a === "--insert" ? [args[i + 1]] : []));
const dry = args.includes("--dry");
const take = opt("--take"), label = opt("--label"), wait = args.includes("--wait");
if (!take || !label) { console.error("usage: bake-run.mjs --take <id-prefix> --label <label> [--set node.field=value ...] [--insert <json> ...] [--dry] [--wait]"); process.exit(2); }

const dir = readdirSync(TAKES).find((d) => d.startsWith(take));
if (!dir) { console.error(`no take starts with ${take}`); process.exit(2); }
const prompt = JSON.parse(readFileSync(join(TAKES, dir, "workflow.json"), "utf8"));

const edits = {};
for (const s of sets) {
  const m = /^(\d+)\.([^=]+)=(.*)$/.exec(s);
  if (!m) { console.error(`bad --set ${s}`); process.exit(2); }
  const [, node, field, raw] = m;
  if (!prompt[node]) { console.error(`node ${node} is not in the workflow`); process.exit(2); }
  const value = raw === "true" ? true : raw === "false" ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  prompt[node].inputs[field] = value;
  edits[`${node}.${field}`] = value;
}
for (const raw of inserts) {
  let spec;
  try { spec = JSON.parse(raw); } catch { console.error(`bad --insert ${raw}`); process.exit(2); }
  const { id, class_type, on, input, inputs = {} } = spec;
  if (!id || !class_type || !Array.isArray(on) || !input) { console.error(`--insert needs id, class_type, on and input: ${raw}`); process.exit(2); }
  if (prompt[id]) { console.error(`node ${id} already exists`); process.exit(2); }
  if (!prompt[on[0]]) { console.error(`node ${on[0]} is not in the workflow`); process.exit(2); }
  const consumers = [];
  for (const [nid, node] of Object.entries(prompt)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && v[0] === on[0] && v[1] === on[1]) { node.inputs[k] = [id, 0]; consumers.push(`${nid}.${k}`); }
    }
  }
  if (!consumers.length) { console.error(`nothing reads ${on[0]}:${on[1]}`); process.exit(2); }
  prompt[id] = { class_type, inputs: { ...inputs, [input]: on } };
  edits[`insert.${id}`] = { class_type, on, consumers, inputs };
}
const save = Object.values(prompt).find((n) => n.class_type === "SaveVideo");
if (!save) { console.error("the workflow has no SaveVideo node"); process.exit(2); }
save.inputs.filename_prefix = `xolotl/bake_${label}`;
if (dry) { console.log(JSON.stringify({ take: dir, label, edits }, null, 2)); process.exit(0); }

const client_id = randomUUID();
let ws;
if (wait) {
  ws = new WebSocket(`${COMFYUI.replace(/^http/, "ws")}/ws?clientId=${client_id}`);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
}
const response = await fetch(`${COMFYUI}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, client_id }) });
const body = await response.json();
if (!response.ok || !body.prompt_id) { console.error("ComfyUI refused the prompt:", JSON.stringify(body).slice(0, 2000)); process.exit(1); }
const record = JSON.parse(readFileSync(RECORD, "utf8"));
const run = { label, prompt_id: body.prompt_id, take: dir, edits, node_errors: body.node_errors ?? {}, queued_at: new Date().toISOString() };
record.runs.push(run);
writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
console.log(`queued ${label} prompt_id=${body.prompt_id} number=${body.number}`);
if (!wait) process.exit(0);

const outcome = await new Promise((resolve) => {
  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return; // binary preview frames
    const msg = JSON.parse(event.data);
    const d = msg.data || {};
    if (d.prompt_id !== body.prompt_id) return;
    if (msg.type === "progress") process.stdout.write(`\r${label} step ${d.value}/${d.max}   `);
    if (msg.type === "execution_success" || msg.type === "execution_error" || msg.type === "execution_interrupted") resolve(msg.type);
  };
  ws.onclose = () => resolve("socket closed");
});
const history = await (await fetch(`${COMFYUI}/history/${body.prompt_id}`)).json();
const entry = history[body.prompt_id] ?? {};
const at = (type) => (entry.status?.messages ?? []).find((m) => m[0] === type)?.[1]?.timestamp;
const start = at("execution_start"), end = at("execution_success");
const seconds = start && end ? (end - start) / 1000 : null;
const outputs = Object.values(entry.outputs ?? {}).flatMap((o) => (o.images ?? []).filter((i) => i.type === "output").map((i) => `${i.subfolder}/${i.filename}`));
Object.assign(run, { outcome, seconds, outputs });
writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
const clock = seconds == null ? "" : ` in ${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")} (${seconds.toFixed(1)} s, ComfyUI execution_start→execution_success)`;
console.log(`\n${label}: ${outcome}${clock} outputs=${outputs.join(",") || "none"}`);
ws.close();
process.exit(outcome === "execution_success" ? 0 : 1);
