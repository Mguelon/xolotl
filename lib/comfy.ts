import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Comfy, type Job, type Progress } from "@comfyorg/sdk";
import { swapWorkflow, type Graph, type SwapRequest } from "./swap";
import { createTake, hasFile, readTake, takeFile, updateTake, type TakeMeta } from "./takes";

export type JobOutput = { id: string; name: string; type: string; url: string };
export type PublicJob = {
  id: string;
  status: string;
  outputs: JobOutput[];
  error: unknown;
  progress: Progress | null;
  queuePosition: number | null;
  startedAt: string | null;
  completedAt: string | null;
  take: TakeMeta | null;
};

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "canceled", "error", "expired"]);
export const isActive = (status: string) => !TERMINAL.has(status);

function client() {
  const apiKey = process.env.COMFY_API_KEY?.trim() || undefined;
  if (!process.env.COMFY_BASE_URL?.trim() && !apiKey) {
    throw new Error("Set COMFY_BASE_URL to your comfy-api-proxy (for example http://127.0.0.1:8192).");
  }
  return new Comfy({ apiKey, clientInfo: "xolotl" });
}

/** The models the template loads can be swapped by environment, e.g. XOLOTL_UNET for the Singularity merge. */
export function applyModelOverrides(template: Graph): Graph {
  const unet = process.env.XOLOTL_UNET?.trim();
  const turbo = process.env.XOLOTL_TURBO_LORA?.trim();
  const swap = process.env.XOLOTL_SWAP_LORA?.trim();
  if (unet) template["1"].inputs.unet_name = unet;
  if (turbo) template["4"].inputs.lora_name = turbo;
  if (swap) template["850"].inputs.lora_name = swap;
  return template;
}

function publicJob(job: Job, take: TakeMeta | null): PublicJob {
  return {
    id: job.id,
    status: job.status,
    outputs: job.outputs.map((output) => ({
      id: output.id,
      name: output.name,
      type: output.type,
      url: `/api/jobs/${job.id}/outputs/${output.id}`,
    })),
    error: job.error,
    progress: job.progress,
    queuePosition: job.queuePosition,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    take,
  };
}

async function bytes(file: File) {
  return new Uint8Array(await file.arrayBuffer());
}

export async function loadTemplate(): Promise<Graph> {
  const template = JSON.parse(await readFile(join(process.cwd(), "workflows", "swap.api.json"), "utf8")) as Graph;
  return applyModelOverrides(template);
}

export async function submitSwap(
  files: { video: File; character: File },
  settings: Omit<SwapRequest, "video" | "character" | "anchor">,
): Promise<PublicJob> {
  const api = client();
  const template = await loadTemplate();
  const videoBytes = await bytes(files.video);
  const characterBytes = await bytes(files.character);
  const graph = swapWorkflow(template, {
    ...settings,
    video: api.assets.fromBytes(videoBytes, { filename: files.video.name, contentType: files.video.type || "video/mp4" }),
    character: api.assets.fromBytes(characterBytes, { filename: files.character.name, contentType: files.character.type || "image/png" }),
  });
  const job = await api.submit(api.workflows.fromJson(graph));
  // The portable copy names the files instead of the uploaded assets, so it loads in ComfyUI with the same inputs.
  const portable = swapWorkflow(template, { ...settings, video: files.video.name, character: files.character.name });
  const take = await createTake(
    {
      id: job.id,
      createdAt: new Date().toISOString(),
      clip: files.video.name,
      character: files.character.name,
      settings: { start: settings.start, seconds: settings.seconds, size: settings.size, seed: settings.seed, direction: settings.direction },
      status: job.status,
    },
    portable,
    characterBytes,
    files.character.type,
    videoBytes,
  );
  return publicJob(job, take);
}

const saving = new Map<string, Promise<void>>();

async function persistResult(id: string, job: Job): Promise<void> {
  if (await hasFile(id, "result.mp4")) return;
  const videos = job.outputs.filter((candidate) => /mp4|video/i.test(`${candidate.type} ${candidate.contentType} ${candidate.name}`));
  const output = videos.find((candidate) => /result/i.test(candidate.name)) ?? videos[0] ?? job.outputs[0];
  if (!output) return;
  const pending = saving.get(id) ?? output.toFile(takeFile(id, "result.mp4")).then(() => undefined).finally(() => saving.delete(id));
  saving.set(id, pending);
  await pending;
}

export async function getJob(id: string): Promise<PublicJob> {
  const job = await client().jobs.get(id);
  let take = await readTake(id);
  if (take) {
    const startedAt = job.startedAt?.toISOString() ?? take.startedAt ?? null;
    const completedAt = job.completedAt?.toISOString() ?? take.completedAt ?? null;
    const elapsedMs = startedAt && completedAt ? new Date(completedAt).getTime() - new Date(startedAt).getTime() : take.elapsedMs ?? null;
    if (job.status === "succeeded") {
      await persistResult(id, job);
      const result = (await hasFile(id, "result.mp4")) ? "result.mp4" : null;
      if (take.status !== "succeeded" || take.result !== result) {
        take = await updateTake(id, { status: "succeeded", result, startedAt, completedAt, elapsedMs, error: null });
      }
    } else if (take.status !== job.status) {
      const error = job.error ? (typeof job.error === "string" ? job.error : JSON.stringify(job.error)).slice(0, 2000) : null;
      take = await updateTake(id, { status: job.status, startedAt, completedAt, elapsedMs, error });
    }
  }
  return publicJob(job, take);
}

export async function getOutput(jobId: string, outputId: string) {
  const job = await client().jobs.get(jobId);
  const output = job.outputs.find((candidate) => candidate.id === outputId);
  if (!output) throw new Error("Output not found on this job.");
  const { url } = await output.getDownloadUrl();
  return fetch(url);
}
