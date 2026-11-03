import { DEFAULT_STEPS, type SwapSize } from "./swap.ts";
import type { Stage } from "./stage.ts";

type Timing = {
  trackingPerSecond: number;
  firstFixed: number;
  laterFixed: number | null;
  perStep: [number, number];
  history: number;
};

/**
 * Seconds measured on an RTX A4000 16 GB with the default recipe (int8 H3, ref2v 4-step turbo LoRA, int8 video VAE,
 * Veda at 79 %), docs/measurements.md. trackingPerSecond: finding, tracking and framing the person and preparing the
 * clip, per second of clip. firstFixed: the first window's encoding (clip, audio, reference, prompt) and the last
 * decode. laterFixed: what each later window adds besides sampling (decoding the previous one, encoding its own).
 * perStep: one sampling step of the first window, from a crop that fills the canvas loosely (wide shot of a moving
 * person) to a tight one (more of the canvas regenerated). history: a later window's step over the first's, for the
 * 18 frames of history it carries. null = not measured yet, so the interface says nothing (laterFixed null: only
 * parts that fit in one window).
 */
export const TIMING: Record<SwapSize, Timing | null> = {
  // 3c3b914c, 5.1 s framed, tight crop (10 645 tokens regenerated), with Xólotl's mask growth and encode reuse:
  // 307.7 s, 47.4 s per step (334.4 s before them, d431fad3). fde01df1, 10 s framed, loose crop (7 920 / 8 006),
  // before them: windows at 39.6 and 47.1 s per step, 109 s between the two samplings; ed24325b, 10 s on the pack's
  // canvas: 42.8 and 50.8, the same 1.19 for the history. The growth saves 0.9 s per second of clip
  // (scripts/time-prep.py), the reuse only touches the first window.
  "480p": { trackingPerSecond: 8.6, firstFixed: 74, laterFixed: 109, perStep: [39.6, 47.4], history: 1.19 },
  // a2cb4adf, 5.1 s framed at 768p, tight crop (15 537 of 28 416 tokens regenerated), Veda's trained budget, the
  // growth and the reuse: 478.2 s, 79.3 s per step. Only that crop and one window are measured at 768p.
  "768p": { trackingPerSecond: 8.6, firstFixed: 117, laterFixed: null, perStep: [79.3, 79.3], history: 1.19 },
};

/**
 * Seconds from the last step to the saved video: decoding, laying the swap over the clip, saving. 3c3b914c, 5.1 s at
 * 480p: 27 s; 10b416ca, 5 s at 768p (720x1280): 48 s; cd7f6ce1, 13 s at 480p: 37 s.
 */
export const FINISH: Record<SwapSize, number> = { "480p": 30, "768p": 48 };

/** How many H3 windows the pack plans: 124 frames at 24 fps, then 123 new frames per window after 18 of history. */
export function windowCount(seconds: number): number {
  const frames = Math.floor(seconds * 24);
  return frames <= 124 ? 1 : 1 + Math.ceil((frames - 124) / 123);
}

/**
 * A rounded range of minutes for a take, or null when that size has not been measured: from the loose crop's step
 * time to the tight one's, and 5 % either way for what one run does not share with another (a cold ComfyUI loads
 * every model first).
 */
export function estimateMinutes(size: SwapSize, seconds: number, steps = DEFAULT_STEPS): [number, number] | null {
  const total = estimateSeconds(size, seconds, steps);
  return total && [Math.max(1, Math.floor((total[0] * 0.95) / 60)), Math.ceil((total[1] * 1.05) / 60)];
}

/** The take's seconds from the loose crop's step time to the tight one's, or null when that size is not measured. */
function estimateSeconds(size: SwapSize, seconds: number, steps: number): [number, number] | null {
  const timing = TIMING[size];
  if (!timing || !(seconds > 0)) return null;
  const later = windowCount(seconds) - 1;
  if (later && timing.laterFixed === null) return null;
  const laterFixed = timing.laterFixed ?? 0;
  const total = (perStep: number) => timing.trackingPerSecond * seconds + timing.firstFixed + steps * perStep
    + later * (laterFixed + steps * perStep * timing.history);
  return [total(timing.perStep[0]), total(timing.perStep[1])];
}

/**
 * Seconds left of a running take, or null when they cannot be told (the finish, or a size not measured). While it
 * samples: ComfyUI's own count for the window's steps left, the windows after it at the step time ComfyUI measures,
 * and the finish. Before its first step: the measured total less what has passed, never less than the sampling ahead.
 */
export function remainingSeconds(size: SwapSize, seconds: number, stage: Stage, elapsed: number): number | null {
  const timing = TIMING[size];
  if (!timing || stage.name === "finish") return null;
  const perStep = stage.secondsPerStep ?? (timing.perStep[0] + timing.perStep[1]) / 2;
  // what a later window adds: its encoding and the previous one's decode, then its steps with 18 frames of history;
  // not measured at 768p, where the first window's fixed part stands in
  const laterWindow = (timing.laterFixed ?? timing.firstFixed) + stage.steps * perStep * timing.history;
  if (stage.name === "sample" && stage.windowLeft !== null) {
    return stage.windowLeft + (stage.windows - stage.window) * laterWindow + FINISH[size];
  }
  if (stage.window > 1 || stage.step === stage.steps) {
    const ahead = stage.windows - stage.window + (stage.step === stage.steps ? 0 : 1);
    return ahead * laterWindow + FINISH[size];
  }
  const ahead = stage.steps * perStep + (stage.windows - 1) * laterWindow + FINISH[size];
  const total = estimateSeconds(size, seconds, stage.steps);
  return total ? Math.max((total[0] + total[1]) / 2 - elapsed, ahead) : ahead;
}
