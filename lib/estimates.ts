import { DEFAULT_STEPS, type SwapSize } from "./swap.ts";

type Window = { fixed: number; perStep: number };
type Timing = { trackingPerSecond: number; first: Window; later: Window };

/**
 * Seconds measured on an RTX A4000 16 GB with the default recipe (int8 H3, ref2v 4-step turbo LoRA, int8 video VAE,
 * Veda at 79 %), docs/measurements.md. trackingPerSecond: SAM 3.1 finding and following the person, per second of
 * clip. first / later: one window's fixed work (encoding the clip, audio, reference and prompt, then decoding) and its
 * time per sampling step; later windows carry 18 frames of the previous one as history, which makes each step longer.
 * null = not measured yet, so the interface says nothing.
 */
export const TIMING: Record<SwapSize, Timing | null> = {
  // 10 s take through the app (ed24325b): 84 s preparing and tracking, window 1 in 4:00 (42.8 s per step),
  // window 2 in 4:22 (51 s per step with its history), 675 s in all (ComfyUI execution_start → execution_success).
  // With the person framed (d431fad3, 5.1 s) a step is 47.4 s: the crop's canvas regenerates more tokens; the later
  // windows' 56.5 is that 51 scaled the same way, not yet measured.
  "480p": { trackingPerSecond: 8.5, first: { fixed: 100, perStep: 47.4 }, later: { fixed: 117, perStep: 56.5 } },
  "768p": null,
};

/** How many H3 windows the pack plans: 124 frames at 24 fps, then 123 new frames per window after 18 of history. */
export function windowCount(seconds: number): number {
  const frames = Math.floor(seconds * 24);
  return frames <= 124 ? 1 : 1 + Math.ceil((frames - 124) / 123);
}

/** A rounded range of minutes for a take, or null when that size has not been measured. */
export function estimateMinutes(size: SwapSize, seconds: number, steps = DEFAULT_STEPS): [number, number] | null {
  const timing = TIMING[size];
  if (!timing || !(seconds > 0)) return null;
  const later = windowCount(seconds) - 1;
  const total = timing.trackingPerSecond * seconds
    + timing.first.fixed + steps * timing.first.perStep
    + later * (timing.later.fixed + steps * timing.later.perStep);
  return [Math.max(1, Math.floor((total * 0.9) / 60)), Math.ceil((total * 1.1) / 60)];
}
