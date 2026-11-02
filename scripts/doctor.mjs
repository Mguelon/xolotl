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
// Veda and LivePortrait are optional: without Veda a take runs full attention, without LivePortrait it runs without
// the gestures pass (lib/swap.ts fitToInstalled takes them off the wire).
const LIVEPORTRAIT = ["DownloadAndLoadLivePortraitModels", "LivePortraitLoadFaceAlignmentCropper", "LivePortraitCropper",
  "LivePortraitProcess", "LivePortraitComposite"];
const OPTIONAL = new Set(["VedaSparseAttention", ...LIVEPORTRAIT]);
const NODES = [...new Set(Object.values(graph).map((n) => n.class_type))].filter((n) => !OPTIONAL.has(n));
// The template's file first; Xólotl falls back to the fp8 / fp16 file when only that one is installed (lib/swap.ts PREFERRED).
const MODELS = [
  ["diffusion_models", [graph["1"].inputs.unet_name, "minimax_h3_ref2va_pruned_fp8_scaled.safetensors"]],
  ["loras", [graph["4"].inputs.lora_name]],
  ["loras", [graph["850"].inputs.lora_name]],
  ["text_encoders", [graph["6"].inputs.clip_name]],
  ["text_encoders", [graph.describe_model.inputs.clip_name]],
  ["vae", [graph["7"].inputs.vae_name, "minimax_h3_video_vae_fp16.safetensors"]],
  ["vae", [graph["8"].inputs.vae_name]],
  ["checkpoints", [graph["100"].inputs.ckpt_name]],
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
  for (const [folder, files] of MODELS) {
    lists[folder] ??= await json(`${COMFYUI}/models/${folder}`).catch(() => null);
    const found = files.find((file) => Array.isArray(lists[folder]) && lists[folder].includes(file));
    const detail = !found ? "missing (scripts/install-models.sh)" : found !== files[0] ? "fallback: slower than the int8 file" : "";
    row(!!found, `models/${folder}/${found ?? files[0]}`, detail);
  }
  const predictors = await json(`${COMFYUI}/models/veda`).catch(() => []);
  const predictor = graph.veda?.inputs.predictor;
  console.log("VedaSparseAttention" in info && predictors.includes(predictor)
    ? `✓ Veda sparse attention — models/veda/${predictor}`
    : "• Veda sparse attention not installed (optional): takes run full attention. scripts/install-nodes.sh + scripts/install-models.sh add it");
  console.log(LIVEPORTRAIT.every((n) => n in info)
    ? "✓ LivePortrait — the gestures pass (its weights in models/liveportrait: scripts/install-models.sh)"
    : "• LivePortrait not installed (optional): takes run without the gestures pass. scripts/install-nodes.sh + scripts/install-models.sh add it");
}
console.log(failed ? `\n${failed} problem(s).` : "\nAll good — run npm run dev.");
process.exit(failed ? 1 : 0);
