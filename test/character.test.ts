import assert from "node:assert/strict";
import test from "node:test";
import { bodyPrompt, editPrompt, headCount, headPrompt, initialPicks, type Picks } from "../lib/character.ts";
import { canvasFor, imageSize } from "../lib/characters.ts";

const sheep: Picks = { ...initialPicks("head"), kind: "animal", style: "caricatura", species: "sheep", stance: "upright", coat: "wool", coat_color: "black" };

test("the head of an animal that stands like a person is still a head", () => {
  const prompt = headPrompt(sheep);
  assert.match(prompt, /anthropomorphic sheep character, with black curly wool/);
  assert.match(prompt, /Head and shoulders/);
  assert.doesNotMatch(prompt, /two legs/, "said in the head's prompt, it drew the whole body");
});

test("the body says how the character stands, where its legs are drawn", () => {
  const upright = bodyPrompt(sheep, { ...initialPicks("body"), clothes: "a black hoodie" });
  assert.match(upright, /^Full-body image of the same character as in <image1>: /);
  assert.match(upright, /Standing upright on two legs like a person\./);
  assert.match(upright, /Wearing a black hoodie\./);
  const natural = bodyPrompt({ ...sheep, stance: "natural" }, initialPicks("body"));
  assert.doesNotMatch(natural, /two legs/);
  assert.match(natural, /In its natural stance/);
});

test("a picture of your own is named, not described", () => {
  const own = { ...initialPicks("head"), start: "picture", what: "Black Sheep, the mascot of my shop" };
  assert.equal(headPrompt(own), "");
  const prompt = bodyPrompt(own, initialPicks("body"));
  assert.match(prompt, /as in <image1> \(Black Sheep, the mascot of my shop\)\./);
  assert.doesNotMatch(prompt, /an original, fictional/);
});

test("a change asks for that change and nothing else", () => {
  assert.equal(editPrompt("  make the hoodie   red.. "),
    "make the hoodie red. Change only that and keep everything else exactly as it is in <image1>: the same character, "
    + "face, pose, framing, art style, background and lighting.");
  assert.ok(editPrompt("x".repeat(900)).startsWith(`${"x".repeat(400)}. Change only that`));
});

test("one to four heads", () => {
  assert.equal(headCount({ count: "2" }), 2);
  assert.equal(headCount({ count: "9" }), 4);
  assert.equal(headCount({ count: "0" }), 4, "no count is the default four");
  assert.equal(headCount({}), 4);
});

test("a change works on the picture's own shape, at least one megapixel", () => {
  assert.deepEqual(canvasFor({ width: 512, height: 512 }), { width: 1024, height: 1024 });
  assert.deepEqual(canvasFor({ width: 1024, height: 1792 }), { width: 1024, height: 1792 });
  const big = canvasFor({ width: 4000, height: 3000 });
  assert.ok(big.width * big.height <= 1024 * 1792 * 1.01 && big.width % 16 === 0 && big.height % 16 === 0);
  assert.ok(Math.abs(big.width / big.height - 4 / 3) < 0.02);
  assert.deepEqual(canvasFor(null), { width: 1024, height: 1024 });
});

test("reads a PNG's size from its header", () => {
  const png = new Uint8Array(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 1024);
  view.setUint32(20, 1792);
  assert.deepEqual(imageSize(png), { width: 1024, height: 1792 });
  assert.equal(imageSize(new Uint8Array(40)), null);
});
