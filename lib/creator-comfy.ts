/**
 * The creator's jobs on ComfyUI, through the same Comfy API v2 proxy as the swap: the heads (workflows/character-head),
 * and the body or a change (workflows/character-edit, Qwen-Image 2.1 Turbo editing the picture given as <image1>).
 * A job's pictures become versions of its step the first time someone reads it finished.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Picks, Step } from "./character";
import {
  FILE_TYPES, canvasFor, characterFile, imageSize, newVersionId, readCharacter, updateCharacter, writeVersionFile,
  type CharacterJob, type CharacterMeta, type Version,
} from "./characters";
import { comfyClient, isActive } from "./comfy";
import type { Graph } from "./swap";

async function workflow(name: "head" | "edit"): Promise<Graph> {
  return JSON.parse(await readFile(join(process.cwd(), "workflows", `character-${name}.api.json`), "utf8")) as Graph;
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

async function record(id: string, job: CharacterJob, picks?: CharacterMeta["picks"]) {
  await updateCharacter(id, (meta) => {
    meta.jobs.push(job);
    if (picks) meta.picks = { ...meta.picks, ...picks };
  });
  return job;
}

/** Up to four heads in one batch from the head's prompt (lib/character.ts headPrompt). */
export async function submitHeads(id: string, request: { prompt: string; count: number; seed?: number; picks?: CharacterMeta["picks"] }) {
  const api = comfyClient();
  const graph = await workflow("head");
  const seed = request.seed ?? randomSeed();
  graph["5"].inputs.prompt = request.prompt;
  graph["6"].inputs.batch_size = Math.max(1, Math.min(4, Math.round(request.count)));
  graph["9"].inputs.noise_seed = seed;
  graph["13"].inputs.filename_prefix = `xolotl/character/${id.slice(0, 8)}-head`;
  const job = await api.submit(api.workflows.fromJson(graph));
  return record(id, {
    id: job.id, step: "head", kind: "heads", status: job.status, createdAt: new Date().toISOString(), completedAt: null,
    prompt: request.prompt, seed, from: null, error: null, made: [],
  }, request.picks);
}

/** The body around a head (a 1024×1792 canvas), or a change to a head or a body (the picture's own canvas). */
export async function submitEdit(id: string, request: {
  step: Extract<Step, "head" | "body">; kind: "body" | "edit"; from: string; prompt: string; seed?: number; picks?: CharacterMeta["picks"];
}) {
  const meta = await readCharacter(id);
  if (!meta) throw new Error("No such character.");
  const source = [...meta.versions.head, ...meta.versions.body].find((version) => version.id === request.from);
  if (!source) throw new Error("That version is not part of this character.");
  const bytes = new Uint8Array(await readFile(characterFile(id, source.file)));
  const canvas = request.kind === "body" ? { width: 1024, height: 1792 } : canvasFor(imageSize(bytes));
  const api = comfyClient();
  const graph = await workflow("edit");
  const seed = request.seed ?? randomSeed();
  const extension = source.file.split(".").pop() ?? "png";
  graph["20"].inputs.image = api.assets.fromBytes(bytes, { filename: source.file, contentType: FILE_TYPES[extension] ?? "image/png" });
  graph["5"].inputs.prompt = request.prompt;
  graph["6"].inputs.width = canvas.width;
  graph["6"].inputs.height = canvas.height;
  graph["9"].inputs.noise_seed = seed;
  graph["13"].inputs.filename_prefix = `xolotl/character/${id.slice(0, 8)}-${request.step}`;
  const job = await api.submit(api.workflows.fromJson(graph));
  return record(id, {
    id: job.id, step: request.step, kind: request.kind, status: job.status, createdAt: new Date().toISOString(),
    completedAt: null, prompt: request.prompt, seed, from: source.id, error: null, made: [],
  }, request.picks);
}

/** Your own picture of the character, as the head's newest version. */
export async function addPicture(id: string, file: File, picks?: CharacterMeta["picks"]): Promise<CharacterMeta> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
  const version: Version = {
    id: newVersionId(), file: "", createdAt: new Date().toISOString(), source: "picture", prompt: "", seed: null, from: null,
    width: null, height: null,
  };
  version.file = `head-${version.id}.${extension}`;
  const size = imageSize(bytes);
  version.width = size?.width ?? null;
  version.height = size?.height ?? null;
  await writeVersionFile(id, version.file, bytes);
  return updateCharacter(id, (meta) => {
    meta.versions.head.push(version);
    meta.chosen.head = version.id;
    if (picks) meta.picks = { ...meta.picks, ...picks };
  });
}

const persisting = new Map<string, Promise<CharacterMeta>>();

/** The job as ComfyUI has it now. The first read after it succeeded saves its pictures as versions of its step and
 *  makes the first of them the chosen one; later reads find them already there. */
export async function readCharacterJob(id: string, jobId: string): Promise<{ job: CharacterJob; character: CharacterMeta }> {
  const meta = await readCharacter(id);
  const known = meta?.jobs.find((job) => job.id === jobId);
  if (!meta || !known) throw new Error("No such job on this character.");
  if (!isActive(known.status)) return { job: known, character: meta };

  const job = await comfyClient().jobs.get(jobId);
  if (job.status !== "succeeded") {
    if (job.status === known.status) return { job: known, character: meta };
    const error = job.error ? (typeof job.error === "string" ? job.error : JSON.stringify(job.error)).slice(0, 2000) : null;
    const next = await updateCharacter(id, (m) => {
      const j = m.jobs.find((candidate) => candidate.id === jobId);
      if (j) Object.assign(j, { status: job.status, error, completedAt: isActive(job.status) ? null : new Date().toISOString() });
    });
    return { job: next.jobs.find((candidate) => candidate.id === jobId)!, character: next };
  }

  const pending = persisting.get(jobId) ?? (async () => {
    const images = job.outputs.filter((output) => /image|png|jpe?g|webp/i.test(`${output.type} ${output.contentType} ${output.name}`));
    const made: Version[] = [];
    for (const output of images) {
      const version: Version = {
        id: newVersionId(), file: "", createdAt: new Date().toISOString(), source: "generated", prompt: known.prompt,
        seed: known.seed, from: known.from, width: null, height: null,
      };
      version.file = `${known.step}-${version.id}.png`;
      await output.toFile(characterFile(id, version.file));
      const size = imageSize(new Uint8Array(await readFile(characterFile(id, version.file))));
      version.width = size?.width ?? null;
      version.height = size?.height ?? null;
      made.push(version);
    }
    return updateCharacter(id, (m) => {
      const j = m.jobs.find((candidate) => candidate.id === jobId);
      if (!j || j.made.length) return;
      m.versions[known.step].push(...made);
      if (made[0]) m.chosen[known.step] = made[0].id;
      Object.assign(j, { status: "succeeded", completedAt: new Date().toISOString(), made: made.map((v) => v.id), error: null });
    });
  })().finally(() => persisting.delete(jobId));
  persisting.set(jobId, pending);
  const next = await pending;
  return { job: next.jobs.find((candidate) => candidate.id === jobId)!, character: next };
}

export type CreatorPicks = Partial<Record<Step, Picks>>;
