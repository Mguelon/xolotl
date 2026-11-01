/**
 * What ComfyUI's websocket tells a bystander: the queue size and, when the Crystools monitor pack is installed,
 * live GPU utilisation and VRAM. Per-node execution events only go to the client that submitted the prompt
 * (the API proxy), so Xólotl shows elapsed time and GPU activity rather than a made-up percentage.
 */
import type { Installed } from "./swap";

export type Gpu = { utilization: number | null; vramUsedGb: number | null; vramTotalGb: number | null; at: string };
export type Live = { queueRemaining: number | null; gpu: Gpu | null };

type Store = { socket: WebSocket | null; live: Live; timer: ReturnType<typeof setTimeout> | null };

const g = globalThis as unknown as { __xolotlLive?: Store };
const store: Store = (g.__xolotlLive ??= { socket: null, live: { queueRemaining: null, gpu: null }, timer: null });

/** ComfyUI itself, behind the API proxy: for the queue, GPU, exact timings and what is installed. */
export function comfyuiUrl() {
  return (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
}

function wsUrl() {
  return `${comfyuiUrl().replace(/^http/, "ws")}/ws?clientId=xolotl-${process.pid}`;
}

function handle(raw: unknown) {
  if (typeof raw !== "string") return;
  let message: { type?: string; data?: Record<string, unknown> };
  try { message = JSON.parse(raw) as typeof message; } catch { return; }
  const data = message.data ?? {};
  if (message.type === "status") {
    const status = data.status as { exec_info?: { queue_remaining?: number } } | undefined;
    const remaining = status?.exec_info?.queue_remaining;
    store.live.queueRemaining = typeof remaining === "number" ? remaining : store.live.queueRemaining;
  }
  if (message.type === "crystools.monitor") {
    const gpu = (data.gpus as Record<string, unknown>[] | undefined)?.[0];
    if (gpu) {
      const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
      const total = num(gpu.vram_total), used = num(gpu.vram_used);
      store.live.gpu = {
        utilization: num(gpu.gpu_utilization),
        vramUsedGb: used !== null ? Math.round((used / 2 ** 30) * 10) / 10 : null,
        vramTotalGb: total !== null ? Math.round(total / 2 ** 30) : null,
        at: new Date().toISOString(),
      };
    }
  }
}

function connect() {
  if (store.socket || typeof WebSocket === "undefined") return;
  try {
    const socket = new WebSocket(wsUrl());
    store.socket = socket;
    socket.addEventListener("message", (event) => handle(event.data));
    const drop = () => { store.socket = null; store.timer ??= setTimeout(() => { store.timer = null; connect(); }, 5000); };
    socket.addEventListener("close", drop);
    socket.addEventListener("error", drop);
  } catch { store.socket = null; }
}

/** Latest queue size and GPU reading seen on ComfyUI's websocket (GPU only with Crystools installed). */
export function comfyLive(): Live {
  connect();
  const gpu = store.live.gpu && Date.now() - new Date(store.live.gpu.at).getTime() < 15000 ? store.live.gpu : null;
  return { queueRemaining: store.live.queueRemaining, gpu };
}

/**
 * When ComfyUI itself is reachable, its history has the exact execution_start / execution_success
 * timestamps of a prompt — better than the moment the app first saw the job running.
 */
export async function comfyTiming(id: string): Promise<{ startedAt: string; completedAt: string } | null> {
  try {
    const response = await fetch(`${comfyuiUrl()}/history/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const history = (await response.json()) as Record<string, { status?: { messages?: [string, { timestamp?: number }][] } }>;
    const messages = history[id]?.status?.messages ?? [];
    const at = (name: string) => messages.find((m) => m[0] === name)?.[1]?.timestamp;
    const start = at("execution_start"), end = at("execution_success") ?? at("execution_error") ?? at("execution_interrupted");
    if (!start || !end) return null;
    return { startedAt: new Date(start).toISOString(), completedAt: new Date(end).toISOString() };
  } catch { return null; }
}

/**
 * The files in ComfyUI's model folders that the recipe can use and whether the Veda node loaded, so a take runs the
 * fastest recipe the machine has; null when ComfyUI is not reachable (the template then goes as it is).
 */
export async function comfyInstalled(): Promise<Installed | null> {
  const get = async (path: string): Promise<unknown> => {
    const response = await fetch(`${comfyuiUrl()}${path}`, { signal: AbortSignal.timeout(3000) });
    return response.ok ? response.json() : null;
  };
  try {
    const [diffusionModels, vaes, vedaPredictors, veda] = await Promise.all([
      get("/models/diffusion_models"), get("/models/vae"), get("/models/veda"), get("/object_info/VedaSparseAttention"),
    ]);
    if (!Array.isArray(diffusionModels) || !Array.isArray(vaes)) return null;
    return {
      diffusionModels,
      vaes,
      vedaPredictors: Array.isArray(vedaPredictors) ? vedaPredictors : [],
      vedaNode: !!veda && typeof veda === "object" && Object.keys(veda).length > 0,
    };
  } catch { return null; }
}
