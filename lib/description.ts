/**
 * The text ComfyUI's history keeps for a prompt: its nodes' UI text (Preview Any), whitespace collapsed. The SDK
 * hands back files, not a node's text, so the words are read where ComfyUI keeps them, as comfyTiming reads the clock.
 */
export function descriptionFrom(history: unknown, id: string): string | null {
  const entry = (history as Record<string, { outputs?: Record<string, { text?: unknown }> }> | null)?.[id];
  const texts = Object.values(entry?.outputs ?? {}).flatMap((output) => (Array.isArray(output.text) ? output.text : []));
  const text = texts.filter((value): value is string => typeof value === "string").join(" ").split(/\s+/).join(" ").trim();
  return text || null;
}

/**
 * The workflow's prompt with its first sentence about what the character is, when the app knows it (characterIdentity:
 * the creator's picks, or the words the user gave a picture). The workflow's own prompt asks for a person's age, skin
 * and haircut, and a hint put in front of it lost to that: a black sheep in a hoodie came back as "a young adult with
 * greyish-black skin and an afro-style mane". Here the first sentence starts with what the character is, its body is
 * described in fur, wool, feathers or scales, and the example is not a person; the clothes and the trousers are asked
 * for as the workflow asks. A workflow edited past recognition keeps its prompt, the hint in front.
 */
export function promptFor(prompt: string, what: string): string {
  const said = what.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
  const clothes = prompt.indexOf("Second sentence:"), example = prompt.indexOf("For example:");
  if (clothes < 0 || example < clothes) return `This character is ${said}. ${prompt}`;
  return "Describe the character in this picture so that a video model can draw them again. "
    + `Write one paragraph of three sentences; the first starts with "The character is ${said}," and goes on with `
    + "their build, the colour and texture of their skin, fur, wool, feathers or scales, their hair or mane only if "
    + "they have one, their eye colour, and features such as horns, ears, a muzzle, a tail or glasses. "
    + prompt.slice(clothes, example)
    + "For example: The character is an anthropomorphic red fox, slim, with rusty-orange fur, a white muzzle and chest, "
    + "pointed black-tipped ears and amber eyes. She wears a mustard-yellow knit sweater that reaches the waistband of "
    + "her jeans. Her trousers are slim dark-blue jeans.";
}
