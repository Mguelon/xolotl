import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { comfyClient } from "./comfy";
import { comfyuiUrl } from "./comfyui-progress";
import { descriptionFrom, promptFor } from "./description";
import type { Graph } from "./swap";

/** How long a description may take, the model's first load included. */
const DESCRIBE_TIMEOUT_MS = 180_000;

/**
 * What the character in the picture looks like, in the words H3's prompt needs: workflows/describe.api.json runs on
 * the same ComfyUI as the swap, through the same proxy (a small vision-language model reads the picture), and the
 * app only shows the words. Without them a 13 s take showed the performer through a turn; with them it did not
 * (docs/measurements.md, "The character described").
 */
export async function describeCharacter(picture: File, what?: string | null): Promise<string> {
  const api = comfyClient();
  const graph = JSON.parse(await readFile(join(process.cwd(), "workflows", "describe.api.json"), "utf8")) as Graph;
  graph.img.inputs.image = api.assets.fromBytes(new Uint8Array(await picture.arrayBuffer()), {
    filename: picture.name, contentType: picture.type || "image/png",
  });
  if (what) graph.gen.inputs.prompt = promptFor(String(graph.gen.inputs.prompt), what);
  const job = await api.submit(api.workflows.fromJson(graph));
  await job.wait(DESCRIBE_TIMEOUT_MS);
  if (job.status !== "succeeded") throw new Error(`The description ended ${job.status}.`);
  const response = await fetch(`${comfyuiUrl()}/history/${encodeURIComponent(job.id)}`, { signal: AbortSignal.timeout(5000) });
  const text = response.ok ? descriptionFrom(await response.json(), job.id) : null;
  if (!text) throw new Error("ComfyUI finished without a description.");
  return text;
}
