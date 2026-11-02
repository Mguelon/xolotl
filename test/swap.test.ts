import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { XOLOTL_NODES, fitToInstalled, PREFERRED, readSettings, swapPrompt, swapWorkflow, type Graph, type Installed } from "../lib/swap.ts";
import { estimateMinutes, windowCount } from "../lib/estimates.ts";

const template = JSON.parse(readFileSync(new URL("../workflows/swap.api.json", import.meta.url), "utf8")) as Graph;
const request = {
  video: "clip.mp4",
  character: "hero.png",
  direction: "  keep the glasses  ",
  start: 2.5,
  seconds: 5,
  size: "768p" as const,
  seed: 42,
};

test("binds the clip, the character and the chosen part", () => {
  const graph = swapWorkflow(template, request);
  assert.equal(graph["30"].inputs.file, "clip.mp4");
  assert.equal(graph["9"].inputs.image, "hero.png");
  assert.deepEqual(graph.trim.inputs.video, ["30", 0]);
  assert.equal(graph.trim.inputs.start_time, 2.5);
  assert.equal(graph.trim.inputs.duration, 5);
  assert.deepEqual(graph.fit.inputs.video, ["trim", 0], "the chosen part goes to the canvas");
  assert.deepEqual(graph["803"].inputs.source_video, ["trim", 0]);
});

test("asks PrepareVideo for the quality as text (unpatched Akatz pack)", () => {
  assert.equal(swapWorkflow(template, { ...request, size: "480p" })["31"].inputs.resolution, "480");
  assert.equal(swapWorkflow(template, request)["31"].inputs.resolution, "768");
  assert.equal(swapWorkflow(template, { ...request, seconds: 9.4 })["31"].inputs.duration_seconds, 9.4);
});

test("samples 4 steps through the turbo LoRA by default, or the full schedule without it", () => {
  const fast = swapWorkflow(template, request);
  assert.equal(fast["801"].inputs.steps, 4);
  assert.deepEqual(fast["850"].inputs.model, ["4", 0]);
  assert.deepEqual([fast["801"].inputs.sampler_name, fast["801"].inputs.scheduler], ["er_sde", "normal"], "the turbo LoRA's sampler");
  const full = swapWorkflow(template, { ...request, steps: 20, turbo: false });
  assert.equal(full["801"].inputs.steps, 20);
  assert.deepEqual([full["801"].inputs.sampler_name, full["801"].inputs.scheduler], ["res_multistep", "simple"], "H3's own template");
  assert.equal(full["801"].inputs.cfg, 1, "no CFG, as its BasicGuider");
  assert.equal(full["4"], undefined);
  assert.deepEqual(full["850"].inputs.model, ["3", 0]);
  assert.deepEqual(full["800"].inputs.model, ["veda", 0], "Veda stays on the wire");
  assert.ok(!JSON.stringify(full).includes('["4",'));
});

test("runs recipe F: int8 H3, the ref2v 4-step LoRA, the int8 VAE and Veda before the pack", () => {
  const graph = swapWorkflow(template, request);
  assert.equal(graph["1"].inputs.unet_name, PREFERRED.unet[0]);
  assert.equal(graph["4"].inputs.lora_name, "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors");
  assert.equal(graph["7"].inputs.vae_name, PREFERRED.vae[0]);
  assert.equal(graph.veda.class_type, "VedaSparseAttention");
  assert.deepEqual(graph.veda.inputs.model, ["850", 0]);
  assert.equal(graph.veda.inputs.generated_sparsity, request.size === "768p" ? "trained" : "79%");
  assert.deepEqual(graph["800"].inputs.model, ["veda", 0]);
});

test("fits the recipe to what ComfyUI has installed", () => {
  const all: Installed = {
    diffusionModels: [...PREFERRED.unet], vaes: [...PREFERRED.vae],
    vedaPredictors: ["minimax_h3_r2va_veda_preview_fp8.safetensors"], vedaNode: true, xolotl: [...XOLOTL_NODES],
  };
  const fit = (installed: Installed, graph = template) => fitToInstalled(structuredClone(graph), installed);
  assert.deepEqual(fit(all), template, "everything installed: the template as it is");
  const noVeda = fit({ ...all, vedaNode: false });
  assert.equal(noVeda.veda, undefined);
  assert.deepEqual(noVeda["800"].inputs.model, ["850", 0]);
  assert.equal(fit({ ...all, vedaPredictors: [] }).veda, undefined, "the node without its predictor would stop the take");
  const older = fit({ ...all, diffusionModels: [PREFERRED.unet[1]], vaes: [PREFERRED.vae[1]] });
  assert.equal(older["1"].inputs.unet_name, PREFERRED.unet[1]);
  assert.equal(older["7"].inputs.vae_name, PREFERRED.vae[1]);
  const pinned = structuredClone(template);
  pinned["1"].inputs.unet_name = PREFERRED.unet[1];
  assert.equal(fit(all, pinned)["1"].inputs.unet_name, PREFERRED.unet[1], "an installed override is kept");
  assert.equal(fit({ ...all, diffusionModels: [], vaes: [] })["1"].inputs.unet_name, PREFERRED.unet[0], "nothing known: no change");
  const without = (name: string) => ({ ...all, xolotl: all.xolotl.filter((n) => n !== name) });
  const noReuse = fit(without("XolotlReuseEncodes"));
  assert.equal(noReuse.reuse, undefined);
  assert.deepEqual(noReuse["800"].inputs.video_vae, ["7", 0], "without it the pack reads the VAE itself");
  const noGrow = fit(without("XolotlGrowMasks"));
  assert.equal(noGrow["110"].class_type, "H3CharacterSwapExpandMask", "the pack grows the mask itself, same inputs");
  assert.deepEqual(noGrow["110"].inputs, template["110"].inputs);
  assert.equal(noGrow.restore.class_type, "XolotlRestoreSize", "the rest of Xólotl's path stays");
  assert.equal(fit(without("XolotlMapMasks")).restore, undefined, "a missing core node: the pack's own path");
  const bare = fit({ ...all, xolotl: [] });
  assert.equal(bare.fit, undefined);
  assert.equal(bare.restore, undefined);
  assert.deepEqual(bare["31"].inputs.video, ["trim", 0], "the pack reads the clip itself");
  assert.deepEqual(bare["809"].inputs.video, ["808", 0], "and the result is saved at its canvas size");
  for (const id of ["fit0", "31a", "102a", "103a", "104a", "105a", "106a", "107a", "box", "map"]) assert.equal(bare[id], undefined, `${id} goes too`);
  assert.deepEqual(bare["110"].inputs.masks, ["107", 0], "the pack tracks the person on its own canvas");
  assert.ok(!/\["(fit|fit0|restore|box|map|\d+a)",/.test(JSON.stringify(bare)), "nothing reads the removed nodes");
});

test("gives the result back at the clip's own size through Xólotl's nodes", () => {
  for (const size of ["480p", "768p"] as const) {
    const graph = swapWorkflow(template, { ...request, size });
    assert.equal(graph.fit.class_type, "XolotlFitVideo");
    assert.deepEqual(graph.fit.inputs.video, ["trim", 0]);
    assert.equal(graph.fit.inputs.resolution, graph["31"].inputs.resolution, `${size}: one pixel budget`);
    assert.deepEqual(graph["31"].inputs.video, ["fit", 0], "the pack gets the whole clip on its canvas");
    assert.equal(graph.restore.class_type, "XolotlRestoreSize");
    assert.deepEqual(graph.restore.inputs.images, ["807", 0]);
    assert.deepEqual(graph.restore.inputs.masks, ["110", 0], "the region the swap regenerated");
    assert.deepEqual(graph.restore.inputs.fit, ["fit", 1]);
    assert.deepEqual(graph["809"].inputs.video, ["restore", 0]);
    // The first pass frames the person: whole clip on the canvas, the pack's tracking, the box, then the crop's fit.
    assert.deepEqual(graph.fit0.inputs, { resolution: graph.fit.inputs.resolution, video: ["trim", 0] });
    assert.deepEqual(graph["31a"].inputs, { ...graph["31"].inputs, video: ["fit0", 0] });
    assert.deepEqual(graph["105a"].inputs.images, ["31a", 0]);
    assert.deepEqual(graph.box.inputs.masks, ["106a", 0]);
    assert.deepEqual(graph.box.inputs.fit, ["fit0", 1]);
    assert.deepEqual(graph.fit.inputs.crop, ["box", 0]);
    assert.equal(graph.box.class_type, "XolotlPersonBox");
    // The person is tracked once: the first pass's masks go onto the crop's canvas, then the pack grows them.
    assert.equal(graph.map.class_type, "XolotlMapMasks");
    assert.deepEqual(graph.map.inputs, { masks: ["107a", 0], first: ["fit0", 1], fit: ["fit", 1] });
    assert.deepEqual(graph["110"].inputs.masks, ["map", 0]);
    assert.deepEqual(graph["107a"].inputs.masks, ["106a", 0]);
    assert.equal(graph["110"].class_type, "XolotlGrowMasks", "the pack's mask growth, without its cost");
    const sparsity = size === "768p" ? "trained" : "79%";
    assert.equal(graph.veda.inputs.generated_sparsity, sparsity, `${size}: Veda's measured budget`);
    assert.equal(graph.veda.inputs.reference_sparsity, sparsity);
    // The pack's only video VAE goes through the node that skips the first window's repeated encode.
    assert.equal(graph.reuse.class_type, "XolotlReuseEncodes");
    assert.deepEqual(graph.reuse.inputs, { vae: ["7", 0] });
    assert.deepEqual(graph["800"].inputs.video_vae, ["reuse", 0]);
  }
});

test("runs the v1.5 swap LoRA and saves a video", () => {
  const graph = swapWorkflow(template, request);
  assert.equal(graph["850"].inputs.lora_name, "h3_character_swap_v1.5.safetensors");
  assert.equal(graph["801"].inputs.seed, 42);
  assert.equal(graph["809"].class_type, "SaveVideo");
  assert.deepEqual(graph["809"].inputs.video, ["restore", 0]);
  assert.deepEqual([graph["809"].inputs.format, graph["809"].inputs["format.codec"]], ["mp4", "h264"], "kept as encoded");
});

test("uses the first frame through a crop when there is one", () => {
  const graph = swapWorkflow(template, { ...request, anchor: "anchor.png" });
  assert.equal(graph.anchor_image.inputs.image, "anchor.png");
  assert.deepEqual(graph["803"].inputs.anchor, ["anchor_fit", 0]);
  assert.equal(graph["803"].inputs.use_anchor, true);
  assert.match(String(graph["801"].inputs.prompt), /<Picture 2>/);
});

test("drops the first-frame nodes when there is none", () => {
  const graph = swapWorkflow(template, request);
  assert.equal(graph.anchor_image, undefined);
  assert.equal(graph.anchor_fit, undefined);
  assert.equal(graph["803"].inputs.anchor, undefined);
  assert.equal(graph["803"].inputs.use_anchor, false);
  assert.ok(template.anchor_image, "the template stays untouched");
});

test("names the person to replace and what to keep, then the direction", () => {
  assert.equal(
    swapPrompt("  keep the glasses  ", false, " the woman with long brown hair "),
    "Replace the woman with long brown hair in <Video 1> with the character in <Picture 1>, keeping that person's gestures "
    + "and poses and the proportions of everything. "
    + "Keep the reference character's face, hair and clothing. Preserve the scene and the audio timing. keep the glasses",
  );
  assert.match(swapPrompt("x", false), /^Replace the person in <Video 1>/, "no description: the person");
  assert.match(swapPrompt("", true), /Start from the first frame in <Picture 2>\.$/);
});

test("reads and checks the settings", () => {
  const form = (entries: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  };
  assert.deepEqual(readSettings(form({ start: "1.234", seconds: "5", size: "480p", seed: "7", direction: "x" })), {
    start: 1.23, seconds: 5, size: "480p", seed: 7, direction: "x", person: "", steps: 4, turbo: true,
  });
  assert.equal(readSettings(form({ seconds: "5", size: "480p", person: "  the man in red  " })).person, "the man in red");
  assert.ok(Number.isInteger(readSettings(form({ seconds: "5", size: "768p" })).seed));
  assert.deepEqual(readSettings(form({ seconds: "5", size: "480p", steps: "20", turbo: "off" })).steps, 20);
  assert.equal(readSettings(form({ seconds: "5", size: "480p", steps: "20", turbo: "off" })).turbo, false);
  assert.throws(() => readSettings(form({ seconds: "5", size: "480p", steps: "0" })), /Steps must be/);
  assert.throws(() => readSettings(form({ seconds: "5", size: "480p", turbo: "maybe" })), /turbo must be/);
  assert.throws(() => readSettings(form({ seconds: "4", size: "768p" })), /between 5 and 15/);
  assert.throws(() => readSettings(form({ seconds: "16", size: "768p" })), /between 5 and 15/);
  assert.throws(() => readSettings(form({ seconds: "5", size: "1080p" })), /480p or 768p/);
  assert.throws(() => readSettings(form({ seconds: "5", size: "768p", seed: "1.5" })), /whole-number seed/);
});

test("counts windows as the pack plans them", () => {
  assert.equal(windowCount(5), 1);
  assert.equal(windowCount(5.1), 1);
  assert.equal(windowCount(10), 2);
  assert.equal(windowCount(15), 3);
});

test("estimates minutes from the measured tracking, window and step times", () => {
  assert.deepEqual(estimateMinutes("480p", 5), [4, 6]);
  assert.deepEqual(estimateMinutes("480p", 5.1), [4, 6], "measured 5:08 tight");
  assert.deepEqual(estimateMinutes("480p", 10), [9, 12], "10:47 before the two nodes that save time");
  assert.deepEqual(estimateMinutes("480p", 15), [15, 19]);
  assert.deepEqual(estimateMinutes("480p", 5, 20), [14, 19]);
  assert.deepEqual(estimateMinutes("768p", 5.1), [7, 9], "measured 7:58");
  assert.equal(estimateMinutes("768p", 10), null, "two windows at 768p are not measured yet");
});
