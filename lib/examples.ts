export type Example = {
  id: string;
  name: string;
  clip: string;
  poster: string;
  character: string;
  characterPoster: string;
  direction: string;
};

/** Real takes made with open models (MiniMax H3 for the clip, Qwen-Image for the characters), bundled so a first run needs no upload. */
export const EXAMPLES: Example[] = [
  {
    id: "terrace-amara",
    name: "Amara",
    clip: "/examples/terrace.mp4",
    poster: "/examples/terrace.jpg",
    character: "/examples/amara.png",
    characterPoster: "/examples/amara.jpg",
    direction:
      "The character is a young Black woman in her early twenties, dark brown skin, long thin box braids past her shoulders, slim build, olive green bomber jacket open over a cream t-shirt, black skinny jeans and white sneakers.",
  },
  {
    id: "terrace-denim",
    name: "Denim",
    clip: "/examples/terrace.mp4",
    poster: "/examples/terrace.jpg",
    character: "/examples/denim.png",
    characterPoster: "/examples/denim.jpg",
    direction:
      "The character is a young woman with long wavy black hair and green eyes, light skin, slim build, a blue denim jacket over a white t-shirt, black skinny jeans and white sneakers.",
  },
];
