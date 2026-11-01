export function jobErrorMessage(error: unknown): string {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && typeof Reflect.get(error, "message") === "string"
        ? Reflect.get(error, "message") as string
        : "";
  const missingNode = message.match(/Node ['"]([^'"]+)['"] not found/i)?.[1];
  if (missingNode) {
    return `Your ComfyUI is missing the “${missingNode}” node. Run scripts/install-nodes.sh and restart ComfyUI.`;
  }
  return message || "ComfyUI could not run this workflow. Check its log and try again.";
}
