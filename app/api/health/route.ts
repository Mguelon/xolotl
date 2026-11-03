import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { applyModelOverrides } from "../../../lib/comfy";
import { comfyInstalled } from "../../../lib/comfyui-progress";
import { adaptations, fitToInstalled, type Graph } from "../../../lib/swap";

export const runtime = "nodejs";

export type Health = {
  ok: boolean;
  proxy: { url: string; ok: boolean };
  comfyui: { url: string; ok: boolean; version: string | null; gpu: string | null; vramGb: number | null };
  missingNodes: string[];
  missingModels: string[];
  /** What the take adapts to this ComfyUI (lib/swap.ts adaptations): it runs, so these do not make the pill red. */
  notes: string[];
  checkedAt: string;
};

let cache: { at: number; body: Health } | null = null;

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json() as Promise<T>;
}

async function check(): Promise<Health> {
  const proxy = (process.env.COMFY_BASE_URL || "http://127.0.0.1:8192").replace(/\/$/, "");
  const comfyui = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
  const health: Health = {
    ok: false,
    proxy: { url: proxy, ok: false },
    comfyui: { url: comfyui, ok: false, version: null, gpu: null, vramGb: null },
    missingNodes: [],
    missingModels: [],
    notes: [],
    checkedAt: new Date().toISOString(),
  };
  await json(`${proxy}/api/v2/health`).then(() => { health.proxy.ok = true; }).catch(() => {});
  type Stats = { system?: { comfyui_version?: string }; devices?: { name?: string; vram_total?: number }[] };
  const stats = await json<Stats>(`${comfyui}/system_stats`).catch(() => null);
  if (stats) {
    health.comfyui.ok = true;
    health.comfyui.version = stats.system?.comfyui_version ?? null;
    health.comfyui.gpu = stats.devices?.[0]?.name?.replace(/^cuda:\d+\s*/, "").split(":")[0].trim() ?? null;
    health.comfyui.vramGb = stats.devices?.[0]?.vram_total ? Math.round(stats.devices[0].vram_total / 2 ** 30) : null;
    const template = applyModelOverrides(JSON.parse(await readFile(join(process.cwd(), "workflows", "swap.api.json"), "utf8")) as Graph);
    // What a take runs (loadTemplate): the template fitted to what this ComfyUI has.
    const installed = await comfyInstalled();
    const fitted = installed ? fitToInstalled(structuredClone(template), installed) : template;
    health.notes = adaptations(template, fitted);
    const nodes = [...new Set(Object.values(fitted).map((node) => node.class_type))];
    // ComfyUI answers {} for a node it does not have.
    const present = await Promise.all(nodes.map((node) => json<object>(`${comfyui}/object_info/${encodeURIComponent(node)}`)
      .then((info) => Object.keys(info).length > 0).catch(() => false)));
    health.missingNodes = nodes.filter((_, index) => !present[index]);
    const models: [string, string][] = [
      ["diffusion_models", String(fitted["1"].inputs.unet_name)],
      ["loras", String(fitted["4"].inputs.lora_name)],
      ["loras", String(fitted["850"].inputs.lora_name)],
      ["text_encoders", String(fitted["6"].inputs.clip_name)],
      ["text_encoders", String(fitted.describe_model.inputs.clip_name)],
      ["vae", String(fitted["7"].inputs.vae_name)],
      ["vae", String(fitted["8"].inputs.vae_name)],
      ["checkpoints", String(fitted["100"].inputs.ckpt_name)],
    ];
    if (fitted.veda) models.push(["veda", String(fitted.veda.inputs.predictor)]);
    const lists = new Map<string, string[]>();
    for (const [folder, file] of models) {
      if (!lists.has(folder)) lists.set(folder, await json<string[]>(`${comfyui}/models/${folder}`).catch(() => []));
      if (!lists.get(folder)!.includes(file)) health.missingModels.push(`${folder}/${file}`);
    }
  }
  health.ok = health.proxy.ok && health.comfyui.ok && health.missingNodes.length === 0 && health.missingModels.length === 0;
  return health;
}

export async function GET() {
  if (!cache || Date.now() - cache.at > 15000) cache = { at: Date.now(), body: await check() };
  return NextResponse.json(cache.body, { headers: { "Cache-Control": "no-store" } });
}
