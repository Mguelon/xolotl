/** A take on disk keeps the proxy's error object as JSON text (lib/comfy.ts getJob): its message, or the text as it is. */
function storedMessage(text: string): string {
  if (!text.startsWith("{")) return text;
  try {
    const message: unknown = Reflect.get(JSON.parse(text) as object, "message");
    return typeof message === "string" ? message.trim() : text;
  } catch {
    return text;
  }
}

export function jobErrorMessage(error: unknown): string {
  const message =
    typeof error === "string"
      ? storedMessage(error)
      : error && typeof error === "object" && typeof Reflect.get(error, "message") === "string"
        ? Reflect.get(error, "message") as string
        : "";
  const missingNode = message.match(/Node ['"]([^'"]+)['"] not found/i)?.[1];
  if (missingNode) {
    return `Your ComfyUI is missing the “${missingNode}” node. Run scripts/install-nodes.sh and restart ComfyUI.`;
  }
  // The pack's, when no person is in the part's first frame: it points at controls the app does not have.
  if (/SAM found no subject/i.test(message)) {
    return "No person was found in the first frame of the part. Choose a part where the person is in view from its first frame.";
  }
  // XolotlGrowMasks', with the first 20 frames that kept no mask.
  const lostAt = message.match(/SAM lost the selected person at frames \[([^\]]*)\]/i)?.[1];
  if (lostAt) {
    return `The person left the frame during the part (frames ${lostAt}). Choose a part where they stay in view.`;
  }
  return message || "ComfyUI could not run this workflow. Check its log and try again.";
}
