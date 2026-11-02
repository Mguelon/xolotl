import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { descriptionFrom } from "../lib/description.ts";

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
  assert.deepEqual(graph.gen.inputs.clip, ["detail", 0], "through Xólotl's image detail");
  assert.equal(graph.detail.class_type, "XolotlImageDetail");
  assert.equal(graph.detail.inputs.image_tokens, 1120, "what let Gemma see the corset and the lace cuffs");
  assert.match(graph.gen.inputs.prompt, /^Describe the person in this picture/);
  assert.match(graph.gen.inputs.prompt, /how far it reaches on the body/, "the garments' length, what kept the sweater down");
  assert.match(graph.gen.inputs.prompt, /Do not mention the shoes or the feet/, "the feet pulled a take into showing them");
  assert.deepEqual(graph.out.inputs.source, ["gen", 0]);
});
