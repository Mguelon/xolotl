/**
 * The characters the creator makes, on disk as the takes are: data/characters/<id>/ holds meta.json and every picture,
 * each picture a version of one step (the head, the body, the sheet). The page reads them back to show the versions and
 * to open a character again; the swap will cast from them.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Picks, Step } from "./character";

export const CHARACTERS_DIR = join(process.cwd(), "data", "characters");

export type Version = {
  id: string;
  file: string;
  createdAt: string;
  /** made by the head or edit workflow, or your own picture as it is */
  source: "generated" | "picture";
  prompt: string;
  seed: number | null;
  /** the version this one was drawn from (the head under a body, the picture under a change) */
  from: string | null;
  width: number | null;
  height: number | null;
};
export type CharacterJob = {
  id: string;
  step: Step;
  kind: "heads" | "body" | "edit" | "sheet";
  status: string;
  createdAt: string;
  completedAt: string | null;
  prompt: string;
  seed: number;
  from: string | null;
  error: string | null;
  /** the versions this job made, once it is over */
  made: string[];
};
export type CharacterMeta = {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  picks: Partial<Record<Step, Picks>>;
  versions: Record<Step, Version[]>;
  chosen: Record<Step, string | null>;
  jobs: CharacterJob[];
};

const ID = /^[0-9a-f-]{36}$/;
const FILE = /^(head|body|sheet|picture)-[0-9a-z-]+\.(png|jpg|webp)$/;
export const FILE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

function dir(id: string) {
  if (!ID.test(id)) throw new Error("Not a character id.");
  return join(CHARACTERS_DIR, id);
}

export function characterFile(id: string, file: string) {
  if (!FILE.test(file)) throw new Error("Not a character file.");
  return join(dir(id), file);
}

export async function createCharacter(picks: CharacterMeta["picks"] = {}): Promise<CharacterMeta> {
  const now = new Date().toISOString();
  const meta: CharacterMeta = {
    id: randomUUID(), createdAt: now, updatedAt: now, name: "", picks,
    versions: { head: [], body: [], sheet: [] }, chosen: { head: null, body: null, sheet: null }, jobs: [],
  };
  await mkdir(dir(meta.id), { recursive: true });
  await writeFile(join(dir(meta.id), "meta.json"), JSON.stringify(meta, null, 1) + "\n");
  return meta;
}

export async function readCharacter(id: string): Promise<CharacterMeta | null> {
  try { return JSON.parse(await readFile(join(dir(id), "meta.json"), "utf8")) as CharacterMeta; } catch { return null; }
}

/** One writer at a time per character: polls and the page can both touch meta.json. */
const writing = new Map<string, Promise<unknown>>();
export async function updateCharacter(id: string, change: (meta: CharacterMeta) => CharacterMeta | void): Promise<CharacterMeta> {
  const run = (writing.get(id) ?? Promise.resolve()).then(async () => {
    const meta = await readCharacter(id);
    if (!meta) throw new Error("No such character.");
    const next = change(meta) ?? meta;
    next.updatedAt = new Date().toISOString();
    await writeFile(join(dir(id), "meta.json"), JSON.stringify(next, null, 1) + "\n");
    return next;
  });
  writing.set(id, run.catch(() => undefined));
  return run;
}

export async function listCharacters(): Promise<CharacterMeta[]> {
  let ids: string[] = [];
  try { ids = (await readdir(CHARACTERS_DIR)).filter((name) => ID.test(name)); } catch { return []; }
  const all = await Promise.all(ids.map(readCharacter));
  return all.filter((meta): meta is CharacterMeta => !!meta).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteCharacter(id: string) {
  await rm(dir(id), { recursive: true, force: true });
}

export async function writeVersionFile(id: string, file: string, bytes: Uint8Array) {
  await writeFile(characterFile(id, file), bytes);
}

export const newVersionId = () => randomUUID().slice(0, 8);

/** Width and height from a PNG, JPEG or WebP header, without decoding it; null when the header says neither. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) { at++; continue; }
      const marker = bytes[at + 1];
      const length = view.getUint16(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
      }
      at += 2 + length;
    }
    return null;
  }
  if (bytes.length > 30 && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8X") return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
    if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/** A canvas for a change: the picture's own shape, between one megapixel and the body's 1024×1792, sides in multiples
 *  of 16. A small picture of your own is worked on bigger; a body keeps its size. */
export function canvasFor(size: { width: number; height: number } | null): { width: number; height: number } {
  if (!size || !size.width || !size.height) return { width: 1024, height: 1024 };
  const pixels = Math.min(Math.max(size.width * size.height, 1024 * 1024), 1024 * 1792);
  const scale = Math.sqrt(pixels / (size.width * size.height));
  const side = (n: number) => Math.max(512, Math.min(2048, Math.round((n * scale) / 16) * 16));
  return { width: side(size.width), height: side(size.height) };
}
