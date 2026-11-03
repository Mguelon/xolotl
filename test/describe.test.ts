import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { descriptionFrom, promptFor } from "../lib/description.ts";

test("reads the description ComfyUI keeps in its history", () => {
  const history = { abc: { outputs: { out: { text: ["The character is a young woman\nwith long  wavy auburn hair."] }, img: { images: [] } } } };
  assert.equal(descriptionFrom(history, "abc"), "The character is a young woman with long wavy auburn hair.");
  assert.equal(descriptionFrom(history, "other"), null, "another prompt's entry");
  assert.equal(descriptionFrom({ abc: { outputs: {} } }, "abc"), null, "a run without text");
  assert.equal(descriptionFrom(null, "abc"), null);
});

test("the describe workflow reads the picture and gives its text to a preview", () => {
  const graph = JSON.parse(readFileSync(join(process.cwd(), "workflows", "describe.api.json"), "utf8"));
  assert.equal(graph.img.class_type, "LoadImage");
  assert.equal(graph.gen.class_type, "TextGenerate");
  assert.deepEqual(graph.gen.inputs.image, ["img", 0]);
  assert.deepEqual(graph.gen.inputs.clip, ["clip", 0]);
  assert.equal(graph.clip.inputs.clip_name, "qwen3vl_8b_int8_convrot.safetensors", "the model that saw a bodybuilder's build, the corset and the cropped polo");
  assert.equal(graph.detail, undefined, "Gemma's image budget is not needed: Qwen3-VL sizes the picture itself");
  assert.match(graph.gen.inputs.prompt, /^Describe the person in this picture/);
  assert.match(graph.gen.inputs.prompt, /how far it reaches on the body/, "the garments' length, what kept the sweater down");
  assert.match(graph.gen.inputs.prompt, /Do not mention the shoes or the feet/, "the feet pulled a take into showing them");
  assert.deepEqual(graph.out.inputs.source, ["gen", 0]);
});

test("a character the app knows is described as what it is, not as a person", () => {
  const graph = JSON.parse(readFileSync(join(process.cwd(), "workflows", "describe.api.json"), "utf8"));
  const base: string = graph.gen.inputs.prompt;
  const prompt = promptFor(base, "an anthropomorphic black sheep character with a sheep's face, covered in curly black wool. ");
  assert.match(prompt, /the first starts with "The character is an anthropomorphic black sheep character with a sheep's face, covered in curly black wool,"/);
  assert.match(prompt, /fur, wool, feathers or scales/);
  assert.doesNotMatch(prompt, /naming the cut|an afro/, "the haircut list is what made the sheep's wool an afro");
  assert.match(prompt, /how far it reaches on the body/, "the clothes are asked for as the workflow asks");
  assert.match(prompt, /Do not mention the shoes or the feet/);
  assert.match(prompt, /For example: The character is an anthropomorphic red fox/);
  assert.equal(promptFor("Say what you see.", "a robot"), "This character is a robot. Say what you see.", "an edited workflow keeps its prompt");
});
