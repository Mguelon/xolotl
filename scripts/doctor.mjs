// Checks that Xólotl can reach the Comfy API proxy and that your ComfyUI has the nodes and models the workflow needs.
//   usage: npm run doctor        (reads .env.local; COMFYUI_URL defaults to http://127.0.0.1:8188)
import { readFileSync, existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const PROXY = (process.env.COMFY_BASE_URL || "http://127.0.0.1:8192").replace(/\/$/, "");
const COMFYUI = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const graph = JSON.parse(readFileSync(new URL("../workflows/swap.api.json", import.meta.url), "utf8"));
const NODES = [...new Set(Object.values(graph).map((n) => n.class_type))];
const MODELS = [
  ["diffusion_models", graph["1"].inputs.unet_name],
  ["loras", graph["4"].inputs.lora_name],
  ["loras", graph["850"].inputs.lora_name],
  ["text_encoders", graph["6"].inputs.clip_name],
  ["vae", graph["7"].inputs.vae_name],
  ["vae", graph["8"].inputs.vae_name],
  ["checkpoints", graph["100"].inputs.ckpt_name],
];
let failed = 0;
const row = (ok, what, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${what}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };
async function json(url) { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); }

try { await json(`${PROXY}/api/v2/health`); row(true, `Comfy API proxy at ${PROXY}`); }
catch (e) { row(false, `Comfy API proxy at ${PROXY}`, `not reachable (${e.message}). Run: comfy-api-proxy --comfyui ${COMFYUI} --port ${PROXY.split(":").pop()}`); }

let info = null;
try { const s = await json(`${COMFYUI}/system_stats`); row(true, `ComfyUI at ${COMFYUI}`, `v${s.system?.comfyui_version ?? "?"}, ${s.devices?.[0]?.name ?? ""} ${Math.round((s.devices?.[0]?.vram_total ?? 0) / 2 ** 30)} GB`); info = await json(`${COMFYUI}/object_info`); }
catch (e) { row(false, `ComfyUI at ${COMFYUI}`, `not reachable (${e.message}); set COMFYUI_URL if it runs elsewhere`); }

if (info) {
  const missing = NODES.filter((n) => !(n in info));
  row(missing.length === 0, "workflow nodes", missing.length ? `missing: ${missing.join(", ")} (scripts/install-nodes.sh, then restart ComfyUI)` : `${NODES.length} node types present`);
  const lists = {};
  for (const [folder, file] of MODELS) {
    lists[folder] ??= await json(`${COMFYUI}/models/${folder}`).catch(() => null);
    const ok = Array.isArray(lists[folder]) && lists[folder].includes(file);
    row(ok, `models/${folder}/${file}`, ok ? "" : "missing (scripts/install-models.sh)");
  }
}
console.log(failed ? `\n${failed} problem(s).` : "\nAll good — run npm run dev.");
process.exit(failed ? 1 : 0);
