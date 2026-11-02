/**
 * Where a running take is, read from ComfyUI's own log (GET /internal/logs/raw, what its terminal panel shows): the
 * sampler's progress bar ("9/20 [06:18<07:41, 41.99s/it]") and the swap pack's stage lines. The API proxy does not
 * relay per-node progress and ComfyUI sends it only to the client that queued the prompt, but it prints it.
 */
export type StageName = "prepare" | "encode" | "sample" | "finish";

export type Stage = {
  /** prepare: the clip on the canvas and the person tracked; encode: what H3 reads (references, prompt, the region to
   * regenerate) and its weights loading; sample: the steps; finish: decoding, laying the swap over the clip, saving. */
  name: StageName;
  /** The steps done in this window, of `steps`; null before its first. */
  step: number | null;
  steps: number;
  /** The window being made, of `windows`: a part longer than 124 frames is made in windows. */
  window: number;
  windows: number;
  /** ComfyUI's own measure of one step, and of what is left of this window's sampling, in seconds. */
  secondsPerStep: number | null;
  windowLeft: number | null;
};

export type LogEntry = { t: string; m: string };

/** tqdm's bar in seconds per iteration: done/total [elapsed<left, rate s/it]. Bars in it/s (tracking) do not match. */
const BAR = /(\d+)\/(\d+) \[(?:\d+:)?\d+:\d+<((?:\d+:)?\d+:\d+|\?),\s*([\d.]+)s\/it\]/;

function clock(text: string): number | null {
  return text === "?" ? null : text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/**
 * The stage of the prompt ComfyUI is running. ComfyUI runs one prompt at a time, so what follows the last "Prompt
 * executed" line is the running one; each of the pack's windows starts by encoding its references, and its sampler's
 * bar counts `steps`. `startedAgo` (seconds since the take started) tells a take that has only just started, with
 * nothing in the log yet, from one that has just finished: its own "Prompt executed" is then the last line.
 */
export function stageFromLog(entries: LogEntry[], steps: number, windows: number, startedAgo: number): Stage {
  let from = -1;
  entries.forEach((entry, index) => { if (entry.m.includes("Prompt executed")) from = index; });
  const stage: Stage = { name: "prepare", step: null, steps, window: 0, windows, secondsPerStep: null, windowLeft: null };
  const running = entries.slice(from + 1);
  if (from >= 0 && running.length === 0 && startedAgo > 30) return { ...stage, name: "finish", window: windows };
  for (const { m } of running) {
    if (m.includes("H3_STAGE_HANDOFF Start reference VAE encoding")) {
      Object.assign(stage, { name: "encode", window: stage.window + 1, step: null, windowLeft: null });
      continue;
    }
    const bar = BAR.exec(m);
    if (!bar || Number(bar[2]) !== steps) continue;
    stage.step = Number(bar[1]);
    stage.secondsPerStep = Number(bar[4]);
    stage.windowLeft = clock(bar[3]);
    stage.name = stage.step < steps ? "sample" : stage.window < windows ? "encode" : "finish";
  }
  stage.window = Math.min(Math.max(stage.window, 1), windows);
  return stage;
}
