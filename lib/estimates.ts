import { DEFAULT_STEPS, type SwapSize } from "./swap.ts";

type Timing = {
  trackingPerSecond: number;
  firstFixed: number;
  laterFixed: number;
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
 * 18 frames of history it carries. null = not measured yet, so the interface says nothing.
 */
export const TIMING: Record<SwapSize, Timing | null> = {
  // 3c3b914c, 5.1 s framed, tight crop (10 645 tokens regenerated), with Xólotl's mask growth and encode reuse:
  // 307.7 s, 47.4 s per step (334.4 s before them, d431fad3). fde01df1, 10 s framed, loose crop (7 920 / 8 006),
  // before them: windows at 39.6 and 47.1 s per step, 109 s between the two samplings; ed24325b, 10 s on the pack's
  // canvas: 42.8 and 50.8, the same 1.19 for the history. The growth saves 0.9 s per second of clip
  // (scripts/time-prep.py), the reuse only touches the first window.
  "480p": { trackingPerSecond: 8.6, firstFixed: 74, laterFixed: 109, perStep: [39.6, 47.4], history: 1.19 },
  "768p": null,
};

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
  const timing = TIMING[size];
  if (!timing || !(seconds > 0)) return null;
  const later = windowCount(seconds) - 1;
  const total = (perStep: number) => timing.trackingPerSecond * seconds + timing.firstFixed + steps * perStep
    + later * (timing.laterFixed + steps * perStep * timing.history);
  const [loose, tight] = timing.perStep;
  return [Math.max(1, Math.floor((total(loose) * 0.95) / 60)), Math.ceil((total(tight) * 1.05) / 60)];
}
