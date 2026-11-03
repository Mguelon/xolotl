// Makes a character through the app the way the creator page does, and checks that every step comes back:
//   node --experimental-strip-types scripts/check-character.ts [app url, default http://127.0.0.1:3011]
// Four heads of an anthropomorphic black sheep in the 3D animated style (the mascot case), the body in a hoodie and
// jeans around the head the page shows first, then one change to that body in words. Prints each job's seconds and
// the versions it made, and exits 1 when a job fails, makes no picture or a picture is not served. The character stays
// in data/characters, among the page's characters, to be looked at there.
import { bodyPrompt, editPrompt, headCount, headPrompt, initialPicks, type Picks, type Step } from "../lib/character.ts";
import type { CharacterJob, CharacterMeta } from "../lib/characters.ts";

const APP = (process.argv[2] || "http://127.0.0.1:3011").replace(/\/$/, "");
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "canceled", "error", "expired"]);

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${APP}${path}`, body === undefined ? { method } : {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${data.error ?? ""}`);
  return data;
}

const picks: Record<Step, Picks> = {
  head: { ...initialPicks("head"), kind: "animal", style: "caricatura", species: "sheep", stance: "upright", coat: "wool", coat_color: "black" },
  body: { ...initialPicks("body"), outfit: "casual", clothes: "a black hoodie, blue jeans and white sneakers" },
  sheet: initialPicks("sheet"),
};

const failures: string[] = [];
let character = await call<CharacterMeta>("/api/characters", "POST", { picks });
console.log(`character ${character.id}`);

/** Sends one job and reads it every two seconds, as the page does, until it ends: the read that finds it done stores
 *  its pictures as versions. Then checks that each of them is served. */
async function job(name: string, path: string, body: Record<string, unknown>) {
  const sent = Date.now();
  let current = await call<CharacterJob>(`/api/characters/${character.id}/${path}`, "POST", body);
  while (!TERMINAL.has(current.status)) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const next = await call<{ job: CharacterJob; character: CharacterMeta }>(`/api/characters/${character.id}/jobs/${current.id}`);
    current = next.job;
    character = next.character;
  }
  const made = character.versions[current.step].filter((version) => current.made.includes(version.id));
  const served = await Promise.all(made.map(async (version) => {
    const response = await fetch(`${APP}/api/characters/${character.id}/files/${version.file}`);
    return response.ok && (response.headers.get("content-type") ?? "").startsWith("image/");
  }));
  const ok = current.status === "succeeded" && made.length > 0 && served.every(Boolean);
  if (!ok) failures.push(name);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${current.status} in ${((Date.now() - sent) / 1000).toFixed(1)} s · `
    + `${made.map((v) => `${v.file} ${v.width}×${v.height}`).join(", ") || "no pictures"}${current.error ? ` · ${current.error}` : ""}`);
  return ok;
}

if (await job("heads", "heads", { prompt: headPrompt(picks.head), count: headCount(picks.head), picks })) {
  const head = character.chosen.head;
  if (await job("body", "edits", { kind: "body", from: head, prompt: bodyPrompt(picks.head, picks.body), picks })) {
    await job("change", "edits", { kind: "edit", step: "body", from: character.chosen.body, prompt: editPrompt("Make the hoodie bright red") });
  }
}
console.log(failures.length ? `failed: ${failures.join(", ")}` : `all steps came back · ${APP}/create`);
process.exit(failures.length ? 1 : 0);
