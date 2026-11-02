export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

export const MIN_SECONDS = 5;
export const MAX_SECONDS = 15;
export const SIZES = { "480p": "480", "768p": "768" } as const;
export type SwapSize = keyof typeof SIZES;

const MAX_SEED = 2 ** 32 - 1;
const MAX_DIRECTION = 1200;
const MAX_DESCRIPTION = 1200; // Gemma 4 E2B wrote 458-518 characters for each of the four bench pictures
const MAX_PERSON = 120;
/**
 * The ref2v 4-step turbo LoRA's count: on the same clip and seed it kept the identity and colour of 8 and 20 steps
 * (docs/measurements.md). H3's own template runs 20 steps without a turbo LoRA.
 */
export const DEFAULT_STEPS = 4;
const MAX_STEPS = 100;
/**
 * Without the turbo LoRA, H3's own sampling: its official reference-to-video template (comfyui-workflow-templates,
 * video_minimax_h3_r2v.json) runs 20 steps of res_multistep on the simple schedule through a BasicGuider, i.e. no
 * CFG, as cfg 1 here. The swap pack's er_sde on the normal schedule is the turbo LoRA's.
 */
export const FULL_SAMPLING = { sampler_name: "res_multistep", scheduler: "simple" } as const;

export type SwapRequest = {
  video: unknown;
  character: unknown;
  anchor?: unknown;
  /** What the character in <Picture 1> looks like: ComfyUI writes it as soon as the picture is chosen
   * (workflows/describe.api.json) and the user can change it; "" leaves it out. */
  description?: string;
  /** The user's own words, optional, at the end of the prompt: <Picture 1> is the character and <Video 1> the clip. */
  direction: string;
  /** Who in the clip is replaced, as H3 should recognise them ("the woman with long brown hair"); "" = the person. */
  person?: string;
  start: number;
  seconds: number;
  size: SwapSize;
  seed: number;
  /** Sampling steps (default 4, the turbo LoRA's count). */
  steps?: number;
  /** false drops the turbo LoRA: full sampling, as in H3's official template (20 steps). */
  turbo?: boolean;
  /** true adds LivePortrait's pass, an experiment off by default: it gives the mannequin's calm face the clip's pouts and
   * winks, and smears the hands near the face and turns the head twice (docs/measurements.md, "The gestures back"). */
  gestures?: boolean;
  /** true shows H3 the clip's person as a grey mannequin, an option off by default: it keeps the performer's looks out,
   * and with them her gestures; the character described in `description` keeps her looks out and the gestures in
   * (docs/measurements.md, "The character described"). */
  mannequin?: boolean;
};

export const DEFAULT_PERSON = "the person";

/**
 * H3's labels are the order of its references: the character image is <Picture 1> and the clip <Video 1> (the pack
 * passes them that way; comfy/text_encoders/minimax.py). What to keep is only what Mike asked for (2026-11-02: «solo
 * decirle que conserve los gestos y las poses y las proporciones de todo»), nothing written about the gestures
 * themselves: «blows kisses» in the direction put a hand to the mouth where the clip has none (Denim and Inés, the same
 * frames; docs/measurements.md, "Facial expressions"). The close-up of the character's face (XolotlFaceCrop) is the
 * pack's segment reference, the picture after the anchor: <Picture 3> with one, <Picture 2> without
 * (h3_character_swap relay/passes.py `reference`, conditioning.py drops the anchor's slot).
 */
export const CHARACTER_TAG = "<Picture 1>";

export type PromptParts = {
  /** What the character looks like; it goes after its tag, "<Picture 1>: The character is …". */
  description?: string;
  /** The user's own words, last. */
  direction?: string;
  /** Who in the clip is replaced; "" = the person. */
  person?: string;
  withAnchor?: boolean;
  withFace?: boolean;
};

/**
 * Each picture's description goes after its tag, as H3 labels the picture itself ("<Picture 1>: " before its tokens), so
 * a direction that names <Picture 1> refers to a character already described. Without a direction the description is
 * all H3 needs: it is what kept the performer's looks out of the take (docs/measurements.md, "The character described").
 */
export function swapPrompt({ description = "", direction = "", person = "", withAnchor = false, withFace = false }: PromptParts = {}): string {
  const who = person.trim() || DEFAULT_PERSON;
  const looks = description.trim();
  return [
    `Replace ${who} in <Video 1> with the character in ${CHARACTER_TAG}, keeping that person's gestures and poses and the`
    + " proportions of everything.",
    withFace ? `<Picture ${withAnchor ? 3 : 2}> is a close-up of the same character's face.` : "",
    "Keep the reference character's face, hair and clothing.",
    "Preserve the scene and the audio timing.",
    withAnchor ? "Start from the first frame in <Picture 2>." : "",
    looks ? `${CHARACTER_TAG}: ${looks}` : "",
    direction.trim(),
  ].filter(Boolean).join(" ");
}

/**
 * The nodes that write the prompt inside ComfyUI when the workflow runs without the app: Gemma 4 E2B describes the
 * character picture, seen at 1120 image tokens instead of Generate Text's 280 (XolotlImageDetail), Format Text puts the description after <Picture 1> and the direction after it, and Trim Text
 * takes off the space an empty direction leaves. The app writes the same prompt itself (swapPrompt), with the
 * description the user saw and could change, so a take does not describe the picture twice.
 */
export const PROMPT_NODES = ["describe_model", "describe_detail", "describe", "direction", "prompt", "prompt_trim"] as const;

function dropPromptNodes(graph: Graph) {
  for (const id of PROMPT_NODES) delete graph[id];
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/** Takes a node out of the graph: whatever read it now reads `source`, by default that node's own `model` input. */
function bypass(graph: Graph, id: string, source = graph[id].inputs.model) {
  delete graph[id];
  for (const node of Object.values(graph)) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && value[0] === id) node.inputs[key] = source;
    }
  }
}

/** What the local ComfyUI has: the files in its model folders and whether the Veda and Xólotl nodes loaded. */
export type Installed = {
  diffusionModels: string[];
  vaes: string[];
  vedaPredictors: string[];
  vedaNode: boolean;
  /** The Xólotl nodes ComfyUI loaded (XOLOTL_NODES), by class name. */
  xolotl: string[];
  /** Whether Kijai's LivePortrait nodes loaded (the gestures pass). */
  livePortrait: boolean;
};

/** Xólotl's nodes. The first four give the result back at the clip's size, the next three only save time, the
 * next two keep the character's looks (its face up close, the clip's person as a grey mannequin) and the last gives
 * LivePortrait the clip's calmest face for the gestures. */
export const XOLOTL_NODES = ["XolotlFitVideo", "XolotlPersonBox", "XolotlMapMasks", "XolotlRestoreSize",
  "XolotlGrowMasks", "XolotlReuseEncodes", "XolotlRecoverMasks", "XolotlFaceCrop", "XolotlMannequin",
  "XolotlNeutralFace"] as const;

/** LivePortrait's pass over the swap on the canvas, before it goes back to the clip's size: the clip's calmest face
 * first, both faces cropped, the clip's expressions onto the character's face, pasted back, the calm frame dropped. */
const GESTURES = ["lp_pair", "lp_models", "lp_detector", "lp_crop_swap", "lp_crop_clip", "lp", "lp_paste", "lp_frames"];

/** The swap goes back to the clip's size as the pack assembled it: no gestures pass. */
function dropGestures(graph: Graph) {
  if (!graph.lp_frames) return;
  const images = graph.restore?.inputs.images;
  if (Array.isArray(images) && images[0] === "lp_frames") graph.restore.inputs.images = graph.lp_pair.inputs.swap;
  for (const id of GESTURES) delete graph[id];
}

/** H3 reads the clip as it is: the pack's source straight from PrepareVideo. */
function dropMannequin(graph: Graph) {
  if (!graph.mannequin) return;
  graph["803"].inputs.source = graph.mannequin.inputs.images;
  delete graph.mannequin;
}

/** Fastest first. The int8 files need ComfyUI on CUDA 13 (comfy-kitchen kernels); fp8 / fp16 run everywhere. */
export const PREFERRED = {
  unet: ["minimax_h3_ref2va_pruned_int8_convrot.safetensors", "minimax_h3_ref2va_pruned_fp8_scaled.safetensors"],
  vae: ["minimax_h3_video_vae_int8_convrot.safetensors", "minimax_h3_video_vae_fp16.safetensors"],
};

/** The first pass that frames the person: the whole clip on the canvas, the pack's tracking, the person's box, and
 * the masks carried onto the crop (the person is tracked once). */
const FIRST_PASS = ["map", "box", "107a", "106a", "105a", "104a", "103a", "102a", "31a", "fit0"];

/**
 * Runs the template's recipe with what is installed: a model file ComfyUI does not have gives way to the next one it
 * has, Veda leaves the model wire when its node or predictor is missing (the take then runs full attention), and
 * without Xólotl's own nodes the clip goes to the pack as it is (cropped to its canvas and returned at that size),
 * and the first pass that frames the person goes with them.
 */
export function fitToInstalled(graph: Graph, installed: Installed): Graph {
  const pick = (current: unknown, preferred: string[], have: string[]) =>
    have.includes(String(current)) ? current : preferred.find((name) => have.includes(name)) ?? current;
  graph["1"].inputs.unet_name = pick(graph["1"].inputs.unet_name, PREFERRED.unet, installed.diffusionModels);
  graph["7"].inputs.vae_name = pick(graph["7"].inputs.vae_name, PREFERRED.vae, installed.vaes);
  if (graph.veda && !(installed.vedaNode && installed.vedaPredictors.includes(String(graph.veda.inputs.predictor)))) {
    bypass(graph, "veda");
  }
  const has = (name: string) => installed.xolotl.includes(name);
  if (graph.reuse && !has("XolotlReuseEncodes")) bypass(graph, "reuse", graph.reuse.inputs.vae);
  if (!has("XolotlMannequin")) dropMannequin(graph);
  if (!installed.livePortrait || !has("XolotlNeutralFace")) dropGestures(graph);
  if (graph.face && !has("XolotlFaceCrop")) {
    delete graph.face; // the take runs on the full picture alone, and the prompt leaves the close-up out
    delete graph["803"].inputs.segment_reference;
  }
  if (graph["110"]?.class_type === "XolotlGrowMasks" && !has("XolotlGrowMasks")) {
    graph["110"].class_type = "H3CharacterSwapExpandMask"; // the pack's own, same inputs, slower
  }
  if (graph["107a"]?.class_type === "XolotlRecoverMasks" && !has("XolotlRecoverMasks")) {
    graph["107a"].class_type = "H3CharacterSwapRecoverMasks"; // the pack's own, same inputs, SAM loaded a frame at a time
  }
  if (graph.restore && !XOLOTL_NODES.slice(0, 4).every(has)) {
    dropGestures(graph);
    bypass(graph, "restore", ["808", 0]);
    bypass(graph, "fit", graph.fit.inputs.video);
    graph["110"].inputs.masks = ["107", 0]; // the pack tracks the person on its own canvas
    if (graph.mannequin) graph.mannequin.inputs.masks = ["107", 0];
    for (const id of FIRST_PASS) delete graph[id];
  }
  return graph;
}

/**
 * Veda's sparsity per quality. Its R2VA predictor was trained at 1024×768 among other sizes: at 768p its own budget
 * ("trained", 32 key tiles) takes 79.3 s per step against 87.1 s at 79 %, with the same colour and 1 % less fine
 * detail. At 480p the canvas is outside its training and no budget beat 79 % (docs/measurements.md).
 */
export const VEDA_SPARSITY = { "480p": "79%", "768p": "trained" } as const;

export function swapWorkflow(template: Graph, request: SwapRequest): Graph {
  const graph: Graph = structuredClone(template);
  graph["30"].inputs.file = request.video;
  graph["9"].inputs.image = request.character;
  Object.assign(graph.trim.inputs, { start_time: request.start, duration: request.seconds });
  Object.assign(graph["31"].inputs, { resolution: SIZES[request.size], duration_seconds: request.seconds });
  for (const id of ["fit", "fit0"]) if (graph[id]) graph[id].inputs.resolution = SIZES[request.size];
  if (graph["31a"]) Object.assign(graph["31a"].inputs, { resolution: SIZES[request.size], duration_seconds: request.seconds });
  if (graph.veda) {
    const sparsity = VEDA_SPARSITY[request.size];
    Object.assign(graph.veda.inputs, { generated_sparsity: sparsity, reference_sparsity: sparsity });
  }
  Object.assign(graph["801"].inputs, {
    prompt: swapPrompt({
      description: request.description,
      direction: request.direction,
      person: request.person,
      withAnchor: request.anchor !== undefined,
      withFace: graph.face !== undefined,
    }),
    seed: request.seed,
    steps: request.steps ?? DEFAULT_STEPS,
  });
  if (request.turbo === false) {
    bypass(graph, "4");
    Object.assign(graph["801"].inputs, FULL_SAMPLING);
  }
  if (!request.gestures) dropGestures(graph);
  if (!request.mannequin) dropMannequin(graph);
  dropPromptNodes(graph);
  if (request.anchor !== undefined) {
    graph.anchor_image.inputs.image = request.anchor;
  } else {
    delete graph.anchor_image;
    delete graph.anchor_fit;
    delete graph["803"].inputs.anchor;
    graph["803"].inputs.use_anchor = false;
  }
  return graph;
}

/**
 * The workflow for ComfyUI without the app (workflows/xolotl.api.json): the app's default take (480p, no mannequin,
 * no gestures pass, no first frame) with the nodes that describe the picture and write the prompt kept, and one
 * Seconds node for the part's length, which the slice and both Prepare nodes read. Choose a clip and a picture and
 * queue it. scripts/standalone.ts writes the file from the template; a test keeps the two in step.
 */
export function standaloneWorkflow(template: Graph, seconds = 5): Graph {
  const graph = swapWorkflow(template, {
    video: template["30"].inputs.file, character: template["9"].inputs.image, direction: "",
    start: 0, seconds, size: "480p", seed: Number(template["801"].inputs.seed),
  });
  for (const id of PROMPT_NODES) graph[id] = structuredClone(template[id]);
  graph["801"].inputs.prompt = structuredClone(template["801"].inputs.prompt);
  graph.seconds = { class_type: "PrimitiveFloat", inputs: { value: seconds }, _meta: { title: "1 · Seconds of the clip to use (5 to 15)" } };
  graph.trim.inputs.duration = ["seconds", 0];
  for (const id of ["31", "31a"]) if (graph[id]) graph[id].inputs.duration_seconds = ["seconds", 0];
  return graph;
}

export function readSettings(form: FormData): Omit<SwapRequest, "video" | "character" | "anchor"> {
  const start = Number(form.get("start") ?? 0);
  const seconds = Number(form.get("seconds"));
  const size = String(form.get("size"));
  const seedText = String(form.get("seed") ?? "").trim();
  const description = form.get("description");
  const direction = form.get("direction");
  const person = form.get("person");
  const stepsText = String(form.get("steps") ?? "").trim();
  const turboText = String(form.get("turbo") ?? "").trim().toLowerCase();
  const gesturesText = String(form.get("gestures") ?? "").trim().toLowerCase();
  const mannequinText = String(form.get("mannequin") ?? "").trim().toLowerCase();
  if (!Number.isFinite(start) || start < 0) throw new Error("Choose where the part starts.");
  if (!Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    throw new Error(`Choose a part between ${MIN_SECONDS} and ${MAX_SECONDS} seconds long.`);
  }
  if (!(size in SIZES)) throw new Error("Choose 480p or 768p.");
  const seed = seedText ? Number(seedText) : randomSeed();
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error("Use a whole-number seed, or leave it blank.");
  const steps = stepsText ? Number(stepsText) : DEFAULT_STEPS;
  if (!Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS) throw new Error(`Steps must be a whole number from 1 to ${MAX_STEPS}.`);
  if (turboText && !["on", "off", "true", "false", "1", "0"].includes(turboText)) throw new Error("turbo must be on or off.");
  const turbo = !["off", "false", "0"].includes(turboText);
  if (gesturesText && !["on", "off", "true", "false", "1", "0"].includes(gesturesText)) throw new Error("gestures must be on or off.");
  const gestures = ["on", "true", "1"].includes(gesturesText);
  if (mannequinText && !["on", "off", "true", "false", "1", "0"].includes(mannequinText)) throw new Error("mannequin must be on or off.");
  const mannequin = ["on", "true", "1"].includes(mannequinText);
  return {
    steps,
    turbo,
    gestures,
    mannequin,
    start: Math.round(start * 100) / 100,
    seconds: Math.round(seconds * 100) / 100,
    size: size as SwapSize,
    seed,
    description: typeof description === "string" ? description.slice(0, MAX_DESCRIPTION) : "",
    direction: typeof direction === "string" ? direction.slice(0, MAX_DIRECTION) : "",
    person: typeof person === "string" ? person.trim().slice(0, MAX_PERSON) : "",
  };
}
