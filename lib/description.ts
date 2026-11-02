/**
 * The text ComfyUI's history keeps for a prompt: its nodes' UI text (Preview Any), whitespace collapsed. The SDK
 * hands back files, not a node's text, so the words are read where ComfyUI keeps them, as comfyTiming reads the clock.
 */
export function descriptionFrom(history: unknown, id: string): string | null {
  const entry = (history as Record<string, { outputs?: Record<string, { text?: unknown }> }> | null)?.[id];
  const texts = Object.values(entry?.outputs ?? {}).flatMap((output) => (Array.isArray(output.text) ? output.text : []));
  const text = texts.filter((value): value is string => typeof value === "string").join(" ").split(/\s+/).join(" ").trim();
  return text || null;
}
