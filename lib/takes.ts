import { access, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

export const TAKES_DIR = join(process.cwd(), "data", "takes");

export type TakeSettings = {
  start: number;
  seconds: number;
  size: string;
  seed: number;
  direction: string;
  steps?: number;
  turbo?: boolean;
};
export type TakeMeta = {
  id: string;
  createdAt: string;
  clip: string;
  character: string;
  settings: TakeSettings;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  elapsedMs?: number | null;
  result?: string | null;
  error?: string | null;
};

export const TAKE_FILES: Record<string, string> = {
  "result.mp4": "video/mp4",
  "clip.mp4": "video/mp4",
  "character.png": "image/png",
  "character.jpg": "image/jpeg",
  "character.webp": "image/webp",
  "workflow.json": "application/json",
  "meta.json": "application/json",
};

export function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) throw new Error("Not a take id.");
  return id;
}

const dir = (id: string) => join(TAKES_DIR, safeId(id));
export const takeFile = (id: string, file: string) => join(dir(id), file);

export async function hasFile(id: string, file: string): Promise<boolean> {
  try { await access(takeFile(id, file)); return true; } catch { return false; }
}

export async function createTake(meta: TakeMeta, graph: unknown, character: Uint8Array, characterType: string, clip: Uint8Array): Promise<TakeMeta> {
  await mkdir(dir(meta.id), { recursive: true });
  const ext = characterType === "image/jpeg" ? "jpg" : characterType === "image/webp" ? "webp" : "png";
  const stored = { ...meta, character: `character.${ext}` };
  await writeFile(takeFile(meta.id, stored.character), character);
  await writeFile(takeFile(meta.id, "clip.mp4"), clip);
  await writeFile(takeFile(meta.id, "workflow.json"), JSON.stringify(graph, null, 2));
  await writeFile(takeFile(meta.id, "meta.json"), JSON.stringify(stored, null, 2));
  return stored;
}

export async function readTake(id: string): Promise<TakeMeta | null> {
  try { return JSON.parse(await readFile(takeFile(id, "meta.json"), "utf8")) as TakeMeta; } catch { return null; }
}

export async function updateTake(id: string, patch: Partial<TakeMeta>): Promise<TakeMeta | null> {
  const current = await readTake(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  await writeFile(takeFile(id, "meta.json"), JSON.stringify(next, null, 2));
  return next;
}

/** Removes a take and everything stored with it. The caller decides whether it may go (not while it is running). */
export async function deleteTake(id: string): Promise<void> {
  await rm(join(TAKES_DIR, safeId(id)), { recursive: true, force: true });
}

export async function listTakes(): Promise<TakeMeta[]> {
  let ids: string[] = [];
  try { ids = await readdir(TAKES_DIR); } catch { return []; }
  const takes = await Promise.all(ids.map((id) => readTake(id).catch(() => null)));
  return takes
    .filter((take): take is TakeMeta => take !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
