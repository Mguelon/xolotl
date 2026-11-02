// Prints where the take ComfyUI is running is, as the app reads it: node --experimental-strip-types scripts/stage-now.ts [steps] [seconds] [size]
import { stageFromLog, type LogEntry } from "../lib/stage.ts";
import { remainingSeconds, windowCount } from "../lib/estimates.ts";
import type { SwapSize } from "../lib/swap.ts";

const [steps = "4", seconds = "5", size = "480p"] = process.argv.slice(2);
const url = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const body = await (await fetch(`${url}/internal/logs/raw`)).json() as { entries: LogEntry[] };
const stage = stageFromLog(body.entries, Number(steps), windowCount(Number(seconds)), 120);
console.log(JSON.stringify(stage), "| left:", remainingSeconds(size as SwapSize, Number(seconds), stage, 120), "s");
