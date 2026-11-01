import { DEFAULT_STEPS, type SwapSize } from "./swap.ts";

/**
 * Wall-clock minutes per 5 s window, measured on an RTX A4000 16 GB with the fp8 weights and the
 * 8-step turbo LoRA (docs/measurements.md). null = not measured yet, so the interface says nothing.
 */
export const MINUTES_PER_WINDOW: Record<SwapSize, [number, number] | null> = {
  "480p": [9, 12],
  "768p": [28, 32],
};

/** Frames per H3 window at 24 fps; the pack plans one window per 124 frames (5.17 s). */
const WINDOW_SECONDS = 124 / 24;

/** A rounded range of minutes for a take, or null when that size has not been measured. */
export function estimateMinutes(size: SwapSize, seconds: number, steps = DEFAULT_STEPS): [number, number] | null {
  const base = MINUTES_PER_WINDOW[size];
  if (!base || !(seconds > 0)) return null;
  const windows = Math.max(1, Math.ceil(seconds / WINDOW_SECONDS - 1e-6));
  const scale = windows * (steps / DEFAULT_STEPS);
  return [Math.round(base[0] * scale), Math.round(base[1] * scale)];
}
