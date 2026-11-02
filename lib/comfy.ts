import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Comfy, type Job, type Progress } from "@comfyorg/sdk";
import { DEFAULT_STEPS, fitToInstalled, swapWorkflow, type Graph, type SwapRequest, type SwapSize } from "./swap";
import { comfyInstalled, comfyLive, comfyStage, comfyTiming, type Gpu } from "./comfyui-progress";
import { remainingSeconds, windowCount } from "./estimates";
import type { Stage } from "./stage";
import { createTake, hasFile, portableNames, readTake, takeFile, updateTake, type TakeMeta } from "./takes";

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
  gpu: Gpu | null;
  /** Where a running take is (ComfyUI's log) and the seconds it has left; null when they cannot be told. */
  stage: Stage | null;
  remainingSeconds: number | null;
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

/** The models the template loads can be swapped by environment, e.g. XOLOTL_UNET for another H3 build you have. */
export function applyModelOverrides(template: Graph): Graph {
  const unet = process.env.XOLOTL_UNET?.trim();
  const turbo = process.env.XOLOTL_TURBO_LORA?.trim();
  const swap = process.env.XOLOTL_SWAP_LORA?.trim();
  if (unet) template["1"].inputs.unet_name = unet;
  if (turbo) template["4"].inputs.lora_name = turbo;
  if (swap) template["850"].inputs.lora_name = swap;
  return template;
}

function publicJob(job: Job, take: TakeMeta | null, where: { stage: Stage | null; remainingSeconds: number | null } = { stage: null, remainingSeconds: null }): PublicJob {
  const snapshot = job.progress;
  // A take we stopped while it was still queued is dequeued at once; the proxy then no longer sees it and says "expired".
  const status = take?.status === "canceled" && job.status === "expired" ? "canceled" : job.status;
  const live = isActive(status) ? comfyLive() : null;
  return {
    id: job.id,
    status,
    outputs: job.outputs.map((output) => ({
      id: output.id,
      name: output.name,
      type: output.type,
      url: `/api/jobs/${job.id}/outputs/${output.id}`,
    })),
    error: job.error,
    ...where,
    progress: snapshot && (snapshot.value > 0 || (snapshot.nodesTotal ?? 0) > 0) ? snapshot : null,
    queuePosition: job.queuePosition,
    startedAt: job.startedAt?.toISOString() ?? take?.startedAt ?? null,
    completedAt: job.completedAt?.toISOString() ?? take?.completedAt ?? null,
    take,
    gpu: live?.gpu ?? null,
  };
}

async function bytes(file: File) {
  return new Uint8Array(await file.arrayBuffer());
}

/** The swap workflow with any model overrides, fitted to what the local ComfyUI has installed. */
export async function loadTemplate(): Promise<Graph> {
  const template = applyModelOverrides(JSON.parse(await readFile(join(process.cwd(), "workflows", "swap.api.json"), "utf8")) as Graph);
  const installed = await comfyInstalled();
  return installed ? fitToInstalled(template, installed) : template;
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
  // The portable copy names its inputs after the take; the strip offers the clip and the character under those names.
  const names = portableNames(job.id, files.character.type);
  const portable = swapWorkflow(template, { ...settings, video: names.clip, character: names.character });
  const take = await createTake(
    {
      id: job.id,
      createdAt: new Date().toISOString(),
      clip: files.video.name,
      character: files.character.name,
      settings: { start: settings.start, seconds: settings.seconds, size: settings.size, seed: settings.seed, direction: settings.direction, person: settings.person, steps: settings.steps, turbo: settings.turbo },
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
    const now = new Date().toISOString();
    // Once the job is over, ComfyUI's own timestamps replace what the app observed while polling.
    const exact = !isActive(job.status) && take.timing !== "comfyui" ? await comfyTiming(id) : null;
    const startedAt = exact?.startedAt ?? job.startedAt?.toISOString() ?? take.startedAt ?? (job.status === "running" ? now : null);
    const completedAt = exact?.completedAt ?? job.completedAt?.toISOString() ?? take.completedAt ?? (!isActive(job.status) ? now : null);
    const elapsedMs = startedAt && completedAt ? new Date(completedAt).getTime() - new Date(startedAt).getTime() : take.elapsedMs ?? null;
    const timing = exact ? "comfyui" as const : take.timing;
    if (job.status === "succeeded") {
      await persistResult(id, job);
      const result = (await hasFile(id, "result.mp4")) ? "result.mp4" : null;
      if (take.status !== "succeeded" || take.result !== result || exact) {
        take = await updateTake(id, { status: "succeeded", result, startedAt, completedAt, elapsedMs, timing, error: null });
      }
    } else if (take.status === "canceled" && job.status === "expired") {
      // stopped before it ran: keep the take's own word for it
    } else if (take.status !== job.status || take.startedAt !== startedAt || exact) {
      const error = job.error ? (typeof job.error === "string" ? job.error : JSON.stringify(job.error)).slice(0, 2000) : null;
      take = await updateTake(id, { status: job.status, startedAt, completedAt, elapsedMs, timing, error });
    }
  }
  return publicJob(job, take, job.status === "running" && take ? await whereIs(take) : undefined);
}

/** The running take's stage from ComfyUI's log and the seconds it has left by the measured timings. */
async function whereIs(take: TakeMeta): Promise<{ stage: Stage | null; remainingSeconds: number | null }> {
  const { size, seconds } = take.settings;
  const elapsed = take.startedAt ? Math.max(0, (Date.now() - Date.parse(take.startedAt)) / 1000) : 0;
  const stage = await comfyStage(take.settings.steps ?? DEFAULT_STEPS, windowCount(seconds), elapsed);
  const remaining = stage ? remainingSeconds(size as SwapSize, seconds, stage, elapsed) : null;
  return { stage, remainingSeconds: remaining === null ? null : Math.round(remaining) };
}

/** Ask the proxy to stop a take. ComfyUI drops a queued prompt at once; a running one stops at its next check. */
export async function cancelJob(id: string): Promise<PublicJob> {
  const job = await client().jobs.get(id);
  if (!isActive(job.status)) return getJob(id);
  const after = await job.cancel();
  if (after.status === "expired" || after.status === "canceled" || after.status === "cancelled") {
    const take = await readTake(id);
    if (take) await updateTake(id, { status: "canceled", completedAt: new Date().toISOString(), error: null });
  }
  return getJob(id);
}

export async function getOutput(jobId: string, outputId: string) {
  const job = await client().jobs.get(jobId);
  const output = job.outputs.find((candidate) => candidate.id === outputId);
  if (!output) throw new Error("Output not found on this job.");
  const { url } = await output.getDownloadUrl();
  return fetch(url);
}
