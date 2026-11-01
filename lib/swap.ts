export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

export const MIN_SECONDS = 5;
export const MAX_SECONDS = 15;
export const SIZES = { "480p": "480", "768p": "768" } as const;
export type SwapSize = keyof typeof SIZES;

const MAX_SEED = 2 ** 32 - 1;
const MAX_DIRECTION = 500;
/** The pack's default: the 8-step turbo LoRA. H3's own template runs 20 steps without it. */
export const DEFAULT_STEPS = 8;
const MAX_STEPS = 100;

export type SwapRequest = {
  video: unknown;
  character: unknown;
  anchor?: unknown;
  direction: string;
  start: number;
  seconds: number;
  size: SwapSize;
  seed: number;
  /** Sampling steps (default 8, the turbo LoRA's count). */
  steps?: number;
  /** false drops the turbo LoRA: full sampling, as in H3's official template (20 steps). */
  turbo?: boolean;
};

export function swapPrompt(direction: string, withAnchor: boolean): string {
  return [
    "Replace the selected person in <Video 1> with the character in <Picture 1>.",
    "Preserve the source performance, scene and audio timing.",
    withAnchor ? "Start from the first frame in <Picture 2>." : "",
    direction.trim(),
  ].filter(Boolean).join(" ");
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export function swapWorkflow(template: Graph, request: SwapRequest): Graph {
  const graph: Graph = structuredClone(template);
  graph["30"].inputs.file = request.video;
  graph["9"].inputs.image = request.character;
  Object.assign(graph.trim.inputs, { start_time: request.start, duration: request.seconds });
  Object.assign(graph["31"].inputs, { resolution: SIZES[request.size], duration_seconds: request.seconds });
  Object.assign(graph["801"].inputs, {
    prompt: swapPrompt(request.direction, request.anchor !== undefined),
    seed: request.seed,
    steps: request.steps ?? DEFAULT_STEPS,
  });
  if (request.turbo === false) {
    const source = graph["4"].inputs.model;
    delete graph["4"];
    for (const node of Object.values(graph)) {
      for (const [key, value] of Object.entries(node.inputs)) {
        if (Array.isArray(value) && value[0] === "4") node.inputs[key] = source;
      }
    }
  }
  if (request.anchor !== undefined) {
    graph.anchor_image.inputs.image = request.anchor;
  } else {
    delete graph.anchor_image;
    delete graph.anchor_fit;
    delete graph["803"].inputs.anchor;
    graph["803"].inputs.use_anchor = false;
  }
  return graph;
}

export function readSettings(form: FormData): Omit<SwapRequest, "video" | "character" | "anchor"> {
  const start = Number(form.get("start") ?? 0);
  const seconds = Number(form.get("seconds"));
  const size = String(form.get("size"));
  const seedText = String(form.get("seed") ?? "").trim();
  const direction = form.get("direction");
  const stepsText = String(form.get("steps") ?? "").trim();
  const turboText = String(form.get("turbo") ?? "").trim().toLowerCase();
  if (!Number.isFinite(start) || start < 0) throw new Error("Choose where the part starts.");
  if (!Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    throw new Error(`Choose a part between ${MIN_SECONDS} and ${MAX_SECONDS} seconds long.`);
  }
  if (!(size in SIZES)) throw new Error("Choose 480p or 768p.");
  const seed = seedText ? Number(seedText) : randomSeed();
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error("Use a whole-number seed, or leave it blank.");
  const steps = stepsText ? Number(stepsText) : DEFAULT_STEPS;
  if (!Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS) throw new Error(`Steps must be a whole number from 1 to ${MAX_STEPS}.`);
  if (turboText && !["on", "off", "true", "false", "1", "0"].includes(turboText)) throw new Error("turbo must be on or off.");
  const turbo = !["off", "false", "0"].includes(turboText);
  return {
    steps,
    turbo,
    start: Math.round(start * 100) / 100,
    seconds: Math.round(seconds * 100) / 100,
    size: size as SwapSize,
    seed,
    direction: typeof direction === "string" ? direction.slice(0, MAX_DIRECTION) : "",
  };
}
