// Remakes public/styles/<style>.webp, the pictures on the creator's style cards, with the creator itself: one head of
// the same woman in each style, through the app as the page asks for heads, with one seed for all, then cut to a
// 256 px WebP with ffmpeg. The character the heads were made on is deleted at the end.
//   node --experimental-strip-types scripts/style-previews.ts [app url, default http://127.0.0.1:3011]
import { spawn } from "node:child_process";
import { join } from "node:path";
import { GROUPS, headPrompt, initialPicks, type Picks } from "../lib/character.ts";
import type { CharacterJob, CharacterMeta } from "../lib/characters.ts";

const APP = (process.argv[2] || "http://127.0.0.1:3011").replace(/\/$/, "");
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "canceled", "error", "expired"]);
const SEED = 20261103;
const STYLES = GROUPS.head.find((group) => group.id === "style");
if (!STYLES || STYLES.kind !== "style") throw new Error("lib/character.ts has no style group");

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${APP}${path}`, body === undefined ? { method } : {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${data.error ?? ""}`);
  return data;
}

/** The PNG through ffmpeg's stdin, out as a 256×256 WebP. */
function webp(png: Uint8Array, out: string) {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-v", "error", "-y", "-f", "png_pipe", "-i", "pipe:0", "-vf", "scale=256:256:flags=lanczos",
      "-quality", "82", out], { stdio: ["pipe", "inherit", "inherit"] });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    ffmpeg.stdin.end(png);
  });
}

const woman: Picks = {
  ...initialPicks("head"), kind: "person", gender: "woman", age: 28, hair_cut: "shoulder", hair_texture: "wavy", hair_color: "brown", count: "1",
  // A head alone comes with bare shoulders: a plain shirt keeps the eight cards alike.
  extra: "wearing a plain white linen shirt",
};
let character = await call<CharacterMeta>("/api/characters", "POST", { picks: { head: woman } });
try {
  for (const style of STYLES.choices) {
    const picks = { ...woman, style: style.id };
    const sent = Date.now();
    let job = await call<CharacterJob>(`/api/characters/${character.id}/heads`, "POST", { prompt: headPrompt(picks), count: 1, seed: SEED });
    while (!TERMINAL.has(job.status)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const next = await call<{ job: CharacterJob; character: CharacterMeta }>(`/api/characters/${character.id}/jobs/${job.id}`);
      job = next.job;
      character = next.character;
    }
    const version = character.versions.head.find((v) => job.made.includes(v.id));
    if (job.status !== "succeeded" || !version) throw new Error(`${style.id}: ${job.status} ${job.error ?? ""}`);
    const png = new Uint8Array(await (await fetch(`${APP}/api/characters/${character.id}/files/${version.file}`)).arrayBuffer());
    await webp(png, join("public", "styles", `${style.id}.webp`));
    console.log(`${style.id}: ${((Date.now() - sent) / 1000).toFixed(1)} s`);
  }
} finally {
  await call(`/api/characters/${character.id}`, "DELETE");
}
