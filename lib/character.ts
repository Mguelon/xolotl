/**
 * The character creator's options, step by step, and the words each one puts in the prompt.
 *
 * The steps are atelier's (api/core/personaje.py): the head first, then the body and its clothes drawn around that
 * head, and last the sheet the swap casts from. The options are buttons, as Higgsfield's AI Influencer Studio and Soul
 * Cast and Cheapsfield's «Criar influencer» do it, instead of a prompt to write. Labels come in both interface languages;
 * what the model reads is always English. The style templates are atelier's (api/core/muestras.py ESTILOS); the
 * previews in public/styles are the creator's own heads in each style (scripts/style-previews.ts, FLUX.2 [klein] 4B).
 */
import type { Lang } from "./i18n";

export type Step = "head" | "body" | "sheet";
export const STEPS: Step[] = ["head", "body", "sheet"];

type Words = { en: string; es: string };
export type Choice = Words & { id: string; say: string; swatch?: string };
type Base = Words & { id: string; hint?: Words; /** shown only when this holds for the step's picks */ when?: (picks: Picks) => boolean };
export type Group =
  | (Base & { kind: "style"; choices: Choice[]; initial: string })
  | (Base & { kind: "one"; choices: Choice[]; initial?: string; swatches?: boolean; required?: boolean })
  | (Base & { kind: "many"; choices: Choice[]; max: number; swatches?: boolean })
  | (Base & { kind: "range"; min: number; max: number; initial: number; unit: Words })
  | (Base & { kind: "text"; placeholder: Words; line?: boolean })
  | (Base & { kind: "image" });

export type Value = string | string[] | number;
export type Picks = Record<string, Value>;

export const word = (w: Words, lang: Lang) => w[lang];

/** The style templates; `{desc}` is who the character is. A head-and-shoulders portrait on a plain white background. */
const STYLE_PROSE: Record<string, string> = {
  realista: "Close-up portrait photograph of {desc}. Head and shoulders, facing the camera with a neutral relaxed expression. Plain white seamless studio background, soft even studio lighting, sharp focus, realistic skin texture, natural proportions, 85mm lens, high-resolution photo.",
  cine: "Cinematic film still, close-up portrait of {desc}. Head and shoulders, facing the camera with a neutral expression. Dramatic moody key light with a soft rim light, shallow depth of field, subtle film grain, teal and amber color grading, anamorphic look, plain white background, high-quality movie frame.",
  anime: "Anime illustration, close-up portrait of {desc}. Head and shoulders, facing the viewer with a calm neutral expression. Clean cel shading, crisp confident line art, large expressive eyes, detailed hair with highlights, plain white background, soft even lighting, high-quality anime key visual.",
  caricatura: "3D animated feature film character render, close-up portrait of {desc}. Head and shoulders, facing the camera with a friendly neutral expression. Stylized appealing proportions with a slightly larger head and big expressive eyes, smooth subsurface-scattering skin, soft studio lighting, plain white background, high-quality modern 3D animation render.",
  ilustracion: "Painted digital illustration, close-up portrait of {desc}. Head and shoulders, facing the viewer with a neutral expression. Expressive visible brushstrokes, rich layered color, painterly character concept art, plain white background, soft directional lighting, high quality.",
  comic: "American comic book illustration, close-up portrait of {desc}. Head and shoulders, facing the viewer with a neutral expression. Bold ink outlines, flat comic colors with halftone shading, dynamic inked details, plain white background, high-quality comic art.",
  acuarela: "Watercolor painting, close-up portrait of {desc}. Head and shoulders, facing the viewer with a neutral expression. Soft translucent washes, wet-on-wet blooms, visible paper texture, loose edges, plain white background, high-quality watercolor illustration.",
  plastilina: "Claymation stop-motion puppet, close-up portrait of {desc}. Head and shoulders, facing the camera with a neutral expression. Hand-sculpted modeling clay with fingerprints and subtle imperfections, matte clay texture, soft studio lighting, plain white background, high-quality stop-motion still.",
};

const STYLE: Choice[] = [
  { id: "realista", en: "Realistic", es: "Realista", say: "" },
  { id: "cine", en: "Cinematic", es: "Cine", say: "" },
  { id: "anime", en: "Anime", es: "Anime", say: "" },
  { id: "caricatura", en: "3D animated", es: "3D animado", say: "" },
  { id: "ilustracion", en: "Illustration", es: "Ilustración", say: "" },
  { id: "comic", en: "Comic", es: "Cómic", say: "" },
  { id: "acuarela", en: "Watercolor", es: "Acuarela", say: "" },
  { id: "plastilina", en: "Claymation", es: "Plastilina", say: "" },
];

/** Who starts the character: the buttons, from scratch, or a picture of one that already exists (a mascot, a drawing). */
const scratch = (p: Picks) => p.start !== "picture";
const fromPicture = (p: Picks) => p.start === "picture";
/** What the character is, as Higgsfield's Character Type: each kind shows its own buttons. */
const kindIs = (...kinds: string[]) => (p: Picks) => scratch(p) && kinds.includes(String(p.kind));

/** Colors for fur, wool, feathers, scales or an alien's skin. */
const COLORS: Choice[] = [
  { id: "black", en: "Black", es: "Negro", say: "black", swatch: "oklch(20% 0.01 60)" },
  { id: "white", en: "White", es: "Blanco", say: "white", swatch: "oklch(95% 0.01 90)" },
  { id: "grey", en: "Grey", es: "Gris", say: "grey", swatch: "oklch(62% 0.01 250)" },
  { id: "brown", en: "Brown", es: "Café", say: "brown", swatch: "oklch(45% 0.07 55)" },
  { id: "golden", en: "Golden", es: "Dorado", say: "golden", swatch: "oklch(78% 0.12 85)" },
  { id: "orange", en: "Orange", es: "Naranja", say: "orange", swatch: "oklch(70% 0.16 50)" },
  { id: "red", en: "Red", es: "Rojo", say: "red", swatch: "oklch(57% 0.19 28)" },
  { id: "green", en: "Green", es: "Verde", say: "green", swatch: "oklch(62% 0.15 145)" },
  { id: "blue", en: "Blue", es: "Azul", say: "blue", swatch: "oklch(58% 0.14 250)" },
  { id: "purple", en: "Purple", es: "Morado", say: "purple", swatch: "oklch(52% 0.16 305)" },
  { id: "pink", en: "Pink", es: "Rosa", say: "pink", swatch: "oklch(76% 0.11 350)" },
  { id: "spotted", en: "Spotted", es: "Manchado", say: "black-and-white spotted", swatch: "conic-gradient(oklch(20% 0.01 60) 0 25%, oklch(95% 0.01 90) 0 50%, oklch(20% 0.01 60) 0 75%, oklch(95% 0.01 90) 0)" },
];

/** Hair: the cut carries {tex} (texture) and {color}, filled from the other two groups. */
const HAIR_CUT: Choice[] = [
  { id: "buzz", en: "Buzz cut", es: "Rapado", say: "a {color} buzz cut" },
  { id: "short", en: "Short", es: "Corto", say: "short {tex} {color} hair" },
  { id: "bob", en: "Bob", es: "Bob", say: "a {tex} {color} bob" },
  { id: "shoulder", en: "To the shoulders", es: "A los hombros", say: "shoulder-length {tex} {color} hair" },
  { id: "long", en: "Long", es: "Largo", say: "long {tex} {color} hair" },
  { id: "ponytail", en: "Ponytail", es: "Coleta", say: "{tex} {color} hair in a ponytail" },
  { id: "bun", en: "Bun", es: "Chongo", say: "{tex} {color} hair in a bun" },
  { id: "braids", en: "Braids", es: "Trenzas", say: "{color} braids" },
  { id: "locs", en: "Locs", es: "Rastas", say: "{color} locs" },
  { id: "afro", en: "Afro", es: "Afro", say: "a {color} afro" },
  { id: "bald", en: "Bald", es: "Calvo", say: "a shaved bald head" },
];

export const GROUPS: Record<Step, Group[]> = {
  head: [
    { id: "start", kind: "one", en: "Start from", es: "Empieza", required: true, initial: "scratch", choices: [
      { id: "scratch", en: "Scratch", es: "Desde cero", say: "" },
      { id: "picture", en: "Your picture", es: "Tu imagen", say: "" },
    ] },
    { id: "picture", kind: "image", en: "Your character", es: "Tu personaje", when: fromPicture,
      hint: { en: "A drawing, a render or a photo of a character that already exists: a mascot, a logo. Full body is best.", es: "Un dibujo, un render o una foto de un personaje que ya existe: una mascota, un logo. De cuerpo entero es mejor." } },
    { id: "what", kind: "text", line: true, en: "What it is · optional", es: "Qué es · opcional", when: fromPicture,
      placeholder: { en: "e.g. Black Sheep, the mascot of my shop", es: "ej.: Oveja Negra, la mascota de mi negocio" } },
    { id: "kind", kind: "one", en: "Type", es: "Tipo", required: true, initial: "person", when: scratch, choices: [
      { id: "person", en: "Person", es: "Persona", say: "" },
      { id: "animal", en: "Animal", es: "Animal", say: "" },
      { id: "hybrid", en: "Hybrid", es: "Híbrido", say: "" },
      { id: "alien", en: "Alien", es: "Alien", say: "" },
      { id: "other", en: "Something else", es: "Otra cosa", say: "" },
    ] },
    { id: "style", kind: "style", en: "Style", es: "Estilo", choices: STYLE, initial: "realista", when: scratch },
    { id: "species", kind: "one", en: "Animal", es: "Animal", initial: "dog", when: kindIs("animal"), choices: [
      { id: "dog", en: "Dog", es: "Perro", say: "dog" },
      { id: "cat", en: "Cat", es: "Gato", say: "cat" },
      { id: "sheep", en: "Sheep", es: "Oveja", say: "sheep" },
      { id: "fox", en: "Fox", es: "Zorro", say: "fox" },
      { id: "wolf", en: "Wolf", es: "Lobo", say: "wolf" },
      { id: "bear", en: "Bear", es: "Oso", say: "bear" },
      { id: "rabbit", en: "Rabbit", es: "Conejo", say: "rabbit" },
      { id: "elephant", en: "Elephant", es: "Elefante", say: "elephant" },
      { id: "lion", en: "Lion", es: "León", say: "lion" },
      { id: "horse", en: "Horse", es: "Caballo", say: "horse" },
      { id: "owl", en: "Owl", es: "Búho", say: "owl" },
      { id: "frog", en: "Frog", es: "Rana", say: "frog" },
      { id: "lizard", en: "Lizard", es: "Lagarto", say: "lizard" },
      { id: "insect", en: "Insect", es: "Insecto", say: "beetle-like insect" },
    ] },
    { id: "species_other", kind: "text", line: true, en: "Another animal", es: "Otro animal", when: kindIs("animal"),
      placeholder: { en: "e.g. axolotl, raccoon, praying mantis", es: "ej.: ajolote, mapache, mantis" } },
    { id: "stance", kind: "one", en: "Stands", es: "Postura", required: true, initial: "upright", when: kindIs("animal"),
      hint: { en: "Upright, like a person, is what a swap follows best: it copies a person's moves.", es: "De pie, como persona, es lo que mejor sigue el cambio: copia los movimientos de una persona." }, choices: [
      { id: "upright", en: "Upright, like a person", es: "De pie, como persona", say: "" },
      { id: "natural", en: "As the animal does", es: "Como el animal", say: "" },
    ] },
    { id: "coat", kind: "one", en: "Covered in", es: "Cubierto de", when: kindIs("animal"), choices: [
      { id: "fur", en: "Fur", es: "Pelaje", say: "{color} fur" },
      { id: "wool", en: "Wool", es: "Lana", say: "curly {color} wool" },
      { id: "feathers", en: "Feathers", es: "Plumas", say: "{color} feathers" },
      { id: "scales", en: "Scales", es: "Escamas", say: "{color} scales" },
      { id: "smooth", en: "Smooth skin", es: "Piel lisa", say: "smooth {color} skin" },
      { id: "shell", en: "Shell", es: "Caparazón", say: "a hard glossy {color} shell" },
    ] },
    { id: "coat_color", kind: "one", en: "Color", es: "Color", swatches: true, when: kindIs("animal"), choices: COLORS },
    { id: "hybrid", kind: "one", en: "Hybrid", es: "Híbrido", required: true, initial: "centaur", when: kindIs("hybrid"),
      hint: { en: "The person half is chosen below.", es: "La parte de persona se escoge abajo." }, choices: [
      { id: "centaur", en: "Centaur", es: "Centauro", say: "centaur, with the upper body of a person and the lower body of a horse" },
      { id: "merfolk", en: "Merfolk", es: "Sirena", say: "merfolk, with the upper body of a person and a long fish tail" },
      { id: "minotaur", en: "Minotaur", es: "Minotauro", say: "minotaur, with a bull's head and horns on a strong human body" },
      { id: "faun", en: "Faun", es: "Fauno", say: "faun, with a human upper body, goat legs and small curled horns" },
      { id: "harpy", en: "Harpy", es: "Arpía", say: "harpy, with a human body and large feathered wings" },
      { id: "naga", en: "Naga", es: "Naga", say: "naga, with the upper body of a person and the long tail of a snake" },
    ] },
    { id: "alien_legs", kind: "one", en: "Legs", es: "Piernas", required: true, initial: "2", when: kindIs("alien"),
      hint: { en: "Two legs are what a swap follows best: it copies a person's moves.", es: "Con dos piernas es lo que mejor sigue el cambio: copia los movimientos de una persona." }, choices: [
      { id: "0", en: "None, it floats", es: "Ninguna, flota", say: "no legs, floating above the ground" },
      { id: "2", en: "2", es: "2", say: "two legs" },
      { id: "4", en: "4", es: "4", say: "four legs" },
      { id: "6", en: "6", es: "6", say: "six legs" },
      { id: "8", en: "8", es: "8", say: "eight spindly legs" },
    ] },
    { id: "alien_arms", kind: "one", en: "Arms", es: "Brazos", initial: "2", when: kindIs("alien"), choices: [
      { id: "2", en: "2", es: "2", say: "two arms" },
      { id: "4", en: "4", es: "4", say: "four arms" },
      { id: "6", en: "6", es: "6", say: "six arms" },
      { id: "tentacles", en: "Tentacles", es: "Tentáculos", say: "tentacles instead of arms" },
    ] },
    { id: "alien_eyes", kind: "one", en: "Eyes", es: "Ojos", initial: "2", when: kindIs("alien"), choices: [
      { id: "1", en: "1", es: "1", say: "a single large eye" },
      { id: "2", en: "2", es: "2", say: "two large eyes" },
      { id: "3", en: "3", es: "3", say: "three eyes" },
      { id: "many", en: "Many", es: "Muchos", say: "many small eyes" },
    ] },
    { id: "alien_skin", kind: "one", en: "Skin", es: "Piel", when: kindIs("alien"), choices: [
      { id: "scales", en: "Scales", es: "Escamas", say: "scaly skin" },
      { id: "slime", en: "Slimy", es: "Viscosa", say: "slimy glistening skin" },
      { id: "shell", en: "Shell", es: "Caparazón", say: "a hard chitin shell" },
      { id: "metal", en: "Metallic", es: "Metálica", say: "metallic skin" },
      { id: "translucent", en: "Translucent", es: "Translúcida", say: "translucent skin" },
      { id: "fur", en: "Fur", es: "Pelaje", say: "fur" },
    ] },
    { id: "alien_color", kind: "one", en: "Color", es: "Color", swatches: true, when: kindIs("alien"), choices: COLORS },
    { id: "other", kind: "text", line: true, en: "What it is", es: "Qué es", when: kindIs("other"),
      placeholder: { en: "e.g. a gardener robot, a mushroom with legs", es: "ej.: un robot jardinero, un hongo con patas" } },
    { id: "gender", kind: "one", en: "Gender", es: "Género", required: true, initial: "woman", when: kindIs("person", "hybrid"), choices: [
      { id: "woman", en: "Woman", es: "Mujer", say: "woman" },
      { id: "man", en: "Man", es: "Hombre", say: "man" },
      { id: "androgynous", en: "Androgynous", es: "Andrógino", say: "androgynous person" },
    ] },
    { id: "age", when: kindIs("person", "hybrid"), kind: "range", en: "Age", es: "Edad", min: 18, max: 80, initial: 26, unit: { en: "years", es: "años" } },
    { id: "origin", when: kindIs("person", "hybrid"), kind: "many", en: "Origin", es: "Origen", max: 3,
      hint: { en: "Choose more than one for mixed heritage.", es: "Escoge más de uno para una mezcla." }, choices: [
      { id: "african", en: "Africa", es: "África", say: "African" },
      { id: "east_asian", en: "East Asia", es: "Asia del este", say: "East Asian" },
      { id: "south_asian", en: "South Asia", es: "Asia del sur", say: "South Asian" },
      { id: "southeast_asian", en: "Southeast Asia", es: "Sudeste asiático", say: "Southeast Asian" },
      { id: "european", en: "Europe", es: "Europa", say: "European" },
      { id: "latin_american", en: "Latin America", es: "Latinoamérica", say: "Latin American" },
      { id: "middle_eastern", en: "Middle East", es: "Medio Oriente", say: "Middle Eastern" },
      { id: "indigenous", en: "Indigenous", es: "Indígena", say: "Indigenous" },
    ] },
    { id: "skin", when: kindIs("person", "hybrid"), kind: "one", en: "Skin", es: "Piel", swatches: true, choices: [
      { id: "very_fair", en: "Very fair", es: "Muy clara", say: "very fair skin", swatch: "oklch(91% 0.035 65)" },
      { id: "fair", en: "Fair", es: "Clara", say: "fair skin", swatch: "oklch(85% 0.05 62)" },
      { id: "medium", en: "Medium", es: "Media", say: "medium skin", swatch: "oklch(77% 0.07 60)" },
      { id: "olive", en: "Olive", es: "Aceitunada", say: "olive skin", swatch: "oklch(70% 0.07 78)" },
      { id: "tan", en: "Tan", es: "Morena clara", say: "tan skin", swatch: "oklch(63% 0.085 55)" },
      { id: "brown", en: "Brown", es: "Morena", say: "brown skin", swatch: "oklch(52% 0.08 50)" },
      { id: "dark", en: "Dark brown", es: "Oscura", say: "dark brown skin", swatch: "oklch(40% 0.065 45)" },
      { id: "deep", en: "Deep", es: "Muy oscura", say: "deep dark brown skin", swatch: "oklch(30% 0.045 40)" },
    ] },
    { id: "eyes", kind: "one", en: "Eyes", es: "Ojos", swatches: true, when: kindIs("person", "animal", "hybrid"), choices: [
      { id: "dark_brown", en: "Dark brown", es: "Café oscuro", say: "dark brown eyes", swatch: "oklch(30% 0.045 50)" },
      { id: "brown", en: "Brown", es: "Café", say: "brown eyes", swatch: "oklch(43% 0.075 55)" },
      { id: "amber", en: "Amber", es: "Ámbar", say: "amber eyes", swatch: "oklch(63% 0.13 70)" },
      { id: "hazel", en: "Hazel", es: "Avellana", say: "hazel eyes", swatch: "oklch(56% 0.08 95)" },
      { id: "green", en: "Green", es: "Verdes", say: "green eyes", swatch: "oklch(56% 0.1 150)" },
      { id: "blue", en: "Blue", es: "Azules", say: "blue eyes", swatch: "oklch(60% 0.11 245)" },
      { id: "grey", en: "Grey", es: "Grises", say: "grey eyes", swatch: "oklch(67% 0.02 240)" },
    ] },
    { id: "hair_cut", when: kindIs("person", "hybrid"), kind: "one", en: "Haircut", es: "Peinado", choices: HAIR_CUT },
    { id: "hair_texture", when: kindIs("person", "hybrid"), kind: "one", en: "Hair texture", es: "Textura del pelo", choices: [
      { id: "straight", en: "Straight", es: "Lacio", say: "straight" },
      { id: "wavy", en: "Wavy", es: "Ondulado", say: "wavy" },
      { id: "curly", en: "Curly", es: "Rizado", say: "curly" },
      { id: "coily", en: "Coily", es: "Muy rizado", say: "coily" },
    ] },
    { id: "hair_color", when: kindIs("person", "hybrid"), kind: "one", en: "Hair color", es: "Color del pelo", swatches: true, choices: [
      { id: "black", en: "Black", es: "Negro", say: "black", swatch: "oklch(21% 0.01 60)" },
      { id: "dark_brown", en: "Dark brown", es: "Castaño oscuro", say: "dark brown", swatch: "oklch(31% 0.04 50)" },
      { id: "brown", en: "Brown", es: "Castaño", say: "brown", swatch: "oklch(43% 0.06 55)" },
      { id: "blonde", en: "Blonde", es: "Rubio", say: "blonde", swatch: "oklch(80% 0.09 85)" },
      { id: "red", en: "Red", es: "Pelirrojo", say: "copper red", swatch: "oklch(56% 0.15 42)" },
      { id: "grey", en: "Grey", es: "Canoso", say: "grey", swatch: "oklch(71% 0.012 250)" },
      { id: "platinum", en: "Platinum", es: "Platinado", say: "platinum blonde", swatch: "oklch(91% 0.025 95)" },
      { id: "pink", en: "Pink", es: "Rosa", say: "pastel pink", swatch: "oklch(77% 0.11 350)" },
      { id: "blue", en: "Blue", es: "Azul", say: "electric blue", swatch: "oklch(60% 0.14 255)" },
    ] },
    { id: "facial_hair", when: kindIs("person", "hybrid"), kind: "one", en: "Facial hair", es: "Vello facial", choices: [
      { id: "none", en: "None", es: "Sin vello", say: "clean-shaven" },
      { id: "stubble", en: "Stubble", es: "Barba de días", say: "light stubble" },
      { id: "short_beard", en: "Short beard", es: "Barba corta", say: "a short beard" },
      { id: "full_beard", en: "Full beard", es: "Barba completa", say: "a full beard" },
      { id: "mustache", en: "Mustache", es: "Bigote", say: "a mustache" },
      { id: "goatee", en: "Goatee", es: "Perilla", say: "a goatee" },
    ] },
    { id: "details", when: kindIs("person", "hybrid"), kind: "many", en: "Details", es: "Detalles", max: 4,
      hint: { en: "One detail that stands out keeps the face from looking generic.", es: "Un detalle que resalte evita que la cara se vea genérica." }, choices: [
      { id: "freckles", en: "Freckles", es: "Pecas", say: "freckles" },
      { id: "mole", en: "Beauty mark", es: "Lunar", say: "a small beauty mark" },
      { id: "scar", en: "Scar", es: "Cicatriz", say: "a small scar on one cheek" },
      { id: "dimples", en: "Dimples", es: "Hoyuelos", say: "dimples" },
      { id: "glasses", en: "Glasses", es: "Lentes", say: "round glasses" },
      { id: "piercing", en: "Nose piercing", es: "Piercing", say: "a nose piercing" },
      { id: "earrings", en: "Earrings", es: "Aretes", say: "earrings" },
      { id: "tattoo", en: "Face tattoo", es: "Tatuaje en la cara", say: "a small face tattoo" },
      { id: "makeup", en: "Bold makeup", es: "Maquillaje", say: "bold makeup" },
    ] },
    { id: "extra", kind: "text", when: scratch, en: "Anything else", es: "Algo más",
      placeholder: { en: "e.g. thick eyebrows, a gap between the front teeth", es: "ej.: cejas gruesas, separación entre los dientes" } },
    { id: "count", kind: "one", en: "Heads to choose from", es: "Cabezas para escoger", required: true, initial: "4", when: scratch, choices: [
      { id: "1", en: "1", es: "1", say: "" },
      { id: "2", en: "2", es: "2", say: "" },
      { id: "4", en: "4", es: "4", say: "" },
    ] },
  ],
  body: [
    { id: "build", kind: "one", en: "Build", es: "Complexión", required: true, initial: "average", choices: [
      { id: "slim", en: "Slim", es: "Delgada", say: "a slim build" },
      { id: "average", en: "Average", es: "Promedio", say: "an average build" },
      { id: "athletic", en: "Athletic", es: "Atlética", say: "an athletic build" },
      { id: "muscular", en: "Muscular", es: "Musculosa", say: "a muscular build" },
      { id: "stocky", en: "Stocky", es: "Robusta", say: "a stocky build" },
      { id: "plus", en: "Plus-size", es: "Talla grande", say: "a plus-size build" },
    ] },
    { id: "height", kind: "one", en: "Height", es: "Estatura", choices: [
      { id: "short", en: "Short", es: "Baja", say: "short" },
      { id: "average", en: "Average", es: "Media", say: "of average height" },
      { id: "tall", en: "Tall", es: "Alta", say: "tall" },
    ] },
    { id: "outfit", kind: "one", en: "Clothes", es: "Ropa", initial: "casual",
      hint: { en: "Your own words below win over the style.", es: "Lo que escribas abajo manda sobre el estilo." }, choices: [
      { id: "casual", en: "Casual", es: "Casual", say: "casual everyday clothes: a plain t-shirt, jeans and clean sneakers" },
      { id: "street", en: "Streetwear", es: "Urbana", say: "streetwear: an oversized hoodie, cargo pants and chunky sneakers" },
      { id: "smart", en: "Smart", es: "Elegante", say: "smart clothes: a tailored blazer, trousers and leather shoes" },
      { id: "sport", en: "Sport", es: "Deportiva", say: "sportswear: a fitted training top, joggers and running shoes" },
      { id: "formal", en: "Formal", es: "Formal", say: "formal evening wear with polished dress shoes" },
      { id: "work", en: "Workwear", es: "De trabajo", say: "workwear: a sturdy work jacket, utility trousers and boots" },
      { id: "vintage", en: "Vintage", es: "Vintage", say: "vintage 1970s clothes with period details" },
      { id: "fantasy", en: "Fantasy", es: "Fantasía", say: "a fantasy adventurer outfit of layered fabric and worn leather" },
    ] },
    { id: "clothes", kind: "text", en: "The clothes, in your words", es: "La ropa, con tus palabras",
      placeholder: { en: "e.g. an olive bomber jacket open over a cream t-shirt, black jeans, white sneakers", es: "ej.: chamarra bomber verde olivo abierta sobre playera crema, jeans negros, tenis blancos" } },
    { id: "accessories", kind: "many", en: "Accessories", es: "Accesorios", max: 4, choices: [
      { id: "cap", en: "Cap", es: "Gorra", say: "a baseball cap" },
      { id: "hat", en: "Hat", es: "Sombrero", say: "a wide-brimmed hat" },
      { id: "sunglasses", en: "Sunglasses", es: "Lentes de sol", say: "sunglasses" },
      { id: "necklace", en: "Necklace", es: "Collar", say: "a necklace" },
      { id: "watch", en: "Watch", es: "Reloj", say: "a wristwatch" },
      { id: "bag", en: "Bag", es: "Bolsa", say: "a shoulder bag" },
      { id: "backpack", en: "Backpack", es: "Mochila", say: "a backpack" },
      { id: "scarf", en: "Scarf", es: "Bufanda", say: "a scarf" },
      { id: "gloves", en: "Gloves", es: "Guantes", say: "gloves" },
    ] },
  ],
  sheet: [
    { id: "kind", kind: "one", en: "Sheet", es: "Hoja", required: true, initial: "simple", choices: [
      { id: "simple", en: "Simple", es: "Simple", say: "" },
      { id: "full", en: "Full", es: "Completa", say: "" },
    ] },
    { id: "name", kind: "text", line: true, en: "Name", es: "Nombre", placeholder: { en: "e.g. Inés", es: "ej.: Inés" } },
  ],
};

/** What each sheet holds, under its button. */
export const SHEET_KINDS: Record<string, Words> = {
  simple: { en: "The front, the back and the face, in one picture: what the swap casts from.", es: "El frente, la espalda y la cara, en una imagen: con eso el cambio pone a tu personaje." },
  full: { en: "Five views on one floor line, the head at three angles, expressions and the palette.", es: "Cinco vistas sobre una línea de piso, la cabeza en tres ángulos, expresiones y la paleta." },
};

/** What each step takes on the A4000. The head and the body: FLUX.2 [klein] 4B, measured 2026-11-03 (docs/measurements.md:
 *  four heads in 18-24 s, a body in 15-16 s); the simple sheet is a back view (as long as a body) and a close-up of the
 *  face (1024×1024, about 0.6 of a body's pixels), so a body and a little over half another. The full sheet: atelier's
 *  (frontend/lib/personaje.ts, 2026-10-13 and 10-15). */
export const SECONDS = { head: 4, headLoad: 8, body: 16, sheetSimple: 28, sheetFull: 720 };

export function initialPicks(step: Step): Picks {
  const picks: Picks = {};
  for (const group of GROUPS[step]) {
    if (group.kind === "range") picks[group.id] = group.initial;
    else if (group.kind === "many") picks[group.id] = [];
    else if ((group.kind === "one" || group.kind === "style") && group.initial) picks[group.id] = group.initial;
    else picks[group.id] = "";
  }
  return picks;
}

const choiceOf = (step: Step, id: string, value: Value | undefined): Choice | undefined => {
  const group = GROUPS[step].find((g) => g.id === id);
  if (!group || !("choices" in group) || typeof value !== "string") return undefined;
  return group.choices.find((c) => c.id === value);
};
const choicesOf = (step: Step, id: string, value: Value | undefined): Choice[] => {
  const group = GROUPS[step].find((g) => g.id === id);
  if (!group || !("choices" in group) || !Array.isArray(value)) return [];
  return value.map((v) => group.choices.find((c) => c.id === v)).filter((c): c is Choice => !!c);
};
const text = (value: Value | undefined, max = 240) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");
const list = (items: string[]) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").trim();

/** Who the character is, in the words the model reads: «an original, fictional 26-year-old woman of East Asian descent
 *  with fair skin, dark brown eyes, long wavy black hair, freckles and round glasses». Original and fictional on purpose
 *  (Cheapsfield's guard): the creator makes characters, never a likeness of a real person. */
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

export function describeHead(picks: Picks): string {
  const extra = text(picks.extra);
  const tail = extra ? `, ${extra}` : "";
  if (picks.start === "picture") {
    const what = text(picks.what, 120);
    return tidy(`the character in image 1${what ? ` (${what})` : ""}`);
  }
  const kind = String(picks.kind || "person");
  if (kind === "animal") {
    const species = text(picks.species_other, 60) || choiceOf("head", "species", picks.species)?.say || "animal";
    const color = choiceOf("head", "coat_color", picks.coat_color)?.say;
    const coat = choiceOf("head", "coat", picks.coat)?.say.replace("{color} ", color ? `${color} ` : "");
    const eyes = choiceOf("head", "eyes", picks.eyes)?.say;
    // The color goes with the animal («a black sheep»), or only the wool comes out black around a pale, human-looking
    // face; an animal standing like a person keeps its animal face (klein 4B, 2026-11-03).
    const animal = `${color ? `${color} ` : ""}${species}`;
    const who = picks.stance === "natural" ? animal : `anthropomorphic ${animal} character with ${article(species)} ${species}'s face`;
    return tidy(`an original, fictional ${who}${coat ? `, covered in ${coat}` : ""}${eyes ? `, with ${eyes}` : ""}${tail}`);
  }
  if (kind === "alien") {
    const color = choiceOf("head", "alien_color", picks.alien_color)?.say;
    const skin = choiceOf("head", "alien_skin", picks.alien_skin)?.say;
    const traits = [
      choiceOf("head", "alien_eyes", picks.alien_eyes)?.say,
      skin ? `${color ? `${color} ` : ""}${skin}` : color ? `${color} skin` : "",
      choiceOf("head", "alien_arms", picks.alien_arms)?.say,
      choiceOf("head", "alien_legs", picks.alien_legs)?.say,
    ].filter((t): t is string => !!t);
    return tidy(`an original, fictional alien creature${traits.length ? ` with ${list(traits)}` : ""}${tail}`);
  }
  if (kind === "other") return tidy(`an original, fictional ${text(picks.other, 160) || "creature"}${tail}`);

  const gender = choiceOf("head", "gender", picks.gender)?.say ?? "person";
  const age = typeof picks.age === "number" ? Math.round(picks.age) : 26;
  const origins = choicesOf("head", "origin", picks.origin).map((c) => c.say);
  const origin = origins.length === 0 ? "" : origins.length === 1 ? ` of ${origins[0]} descent` : ` of mixed ${list(origins)} descent`;
  const cut = choiceOf("head", "hair_cut", picks.hair_cut);
  const texture = choiceOf("head", "hair_texture", picks.hair_texture)?.say ?? "";
  const color = choiceOf("head", "hair_color", picks.hair_color)?.say ?? "";
  const hair = cut ? tidy(cut.say.replace("{tex}", texture).replace("{color}", color))
    : texture || color ? tidy(`${texture} ${color} hair`) : "";
  const traits = [
    choiceOf("head", "skin", picks.skin)?.say,
    choiceOf("head", "eyes", picks.eyes)?.say,
    hair,
    choiceOf("head", "facial_hair", picks.facial_hair)?.say,
    ...choicesOf("head", "details", picks.details).map((c) => c.say),
  ].filter((t): t is string => !!t);
  const hybrid = kind === "hybrid" ? choiceOf("head", "hybrid", picks.hybrid)?.say : undefined;
  const who = hybrid ? `${hybrid}: the person half is a ${age}-year-old ${gender}${origin}` : `${age}-year-old ${gender}${origin}`;
  return tidy(`an original, fictional ${who}${traits.length ? ` with ${list(traits)}` : ""}${tail}`);
}

/** The head's whole prompt: the style template with who the character is. */
export function headPrompt(picks: Picks): string {
  if (picks.start === "picture") return "";
  const style = typeof picks.style === "string" && STYLE_PROSE[picks.style] ? picks.style : "realista";
  return STYLE_PROSE[style].replace("{desc}", describeHead(picks));
}

/** The body around the head: build, height and clothes. Own words for the clothes win over the clothes style. An animal
 *  that stands like a person says so here, where its legs are drawn: said in the head's prompt, it drew the whole body. */
export function describeBody(picks: Picks, head?: Picks): string {
  const upright = head && head.start !== "picture" && head.kind === "animal" && head.stance !== "natural"
    ? "Standing upright on two legs like a person." : "";
  const build = choiceOf("body", "build", picks.build)?.say;
  const height = choiceOf("body", "height", picks.height)?.say;
  const clothes = text(picks.clothes, 320) || choiceOf("body", "outfit", picks.outfit)?.say || "";
  const accessories = choicesOf("body", "accessories", picks.accessories).map((c) => c.say);
  const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
  const figure = height && build ? `${cap(height)}, with ${build}.` : height ? `${cap(height)}.` : build ? `${cap(build)}.` : "";
  return tidy([
    upright,
    figure,
    clothes && `Wearing ${clothes}${accessories.length ? `, with ${list(accessories)}` : ""}.`,
    !clothes && accessories.length ? `With ${list(accessories)}.` : "",
  ].filter(Boolean).join(" "));
}

/** How many heads a round makes. */
export const headCount = (picks: Picks) => Math.max(1, Math.min(4, Number(picks.count) || 4));

/** How the whole figure stands for its full-body picture: upright and facing the viewer, as the swap's reference wants
 *  it, unless the character has no legs to stand on or stays on four of them. */
function pose(head: Picks): string {
  const own = head.start === "picture";
  const kind = String(head.kind || "person");
  if (!own && kind === "animal" && head.stance === "natural") return "In its natural stance, side-on enough to show its whole body,";
  if (!own && kind === "hybrid" && (head.hybrid === "merfolk" || head.hybrid === "naga")) return "Upright on its tail, facing the viewer,";
  if (!own && kind === "alien" && head.alien_legs === "0") return "Floating upright, facing the viewer,";
  return "Standing upright in a relaxed natural pose facing the viewer, arms resting at the sides,";
}

/** The body around the chosen head (image 1), on a 1024×1792 canvas: what workflows/character-edit.api.json reads.
 *  Measured 2026-11-03 (docs/measurements.md): 15-16 s with FLUX.2 [klein] 4B, the head's face kept. */
export function bodyPrompt(head: Picks, body: Picks): string {
  const who = head.start === "picture"
    ? (text(head.what, 120) ? ` (${text(head.what, 120)})` : "")
    : `: ${describeHead(head)}`;
  return tidy(`Full-body image of the same character as in image 1${who}. ${describeBody(body, head)} ${pose(head)} the whole `
    + "figure visible from head to toe with space above and below it. Plain white seamless studio background, soft "
    + "even studio lighting. Keep exactly the same face, head, hair, colors, art style and rendering as in image 1.");
}

/** The back view for the simple sheet, drawn from the body (image 1): the hair and the clothes from behind, which H3
 *  otherwise makes up, or takes from the performer, when the person in the clip turns around (docs/measurements.md). */
export function backPrompt(): string {
  return "The same character as in image 1, turned around and seen from directly behind: a back view of the whole figure "
    + "from head to toe, in the same pose as in image 1, with space above and below it. Exactly the same body, proportions, "
    + "hair, clothes, shoes, colors, art style and rendering as in image 1, as they look from behind. Plain white "
    + "seamless studio background, soft even studio lighting.";
}

/** The face up close for the simple sheet, drawn from the body (image 1) at its own 1024×1024: cut from the body and
 *  enlarged, it would have the few pixels the face has in a full figure. */
export function facePrompt(): string {
  return "A close-up portrait of the same character as in image 1: the head and the top of the shoulders filling the "
    + "frame, facing the viewer with a neutral expression. Exactly the same face, eyes, hair, skin, colors, clothes, art "
    + "style and rendering as in image 1, in sharp detail. Plain white seamless studio background, soft even studio "
    + "lighting.";
}

/** A change asked in the box under the picture: only that, on the picture it is asked of (atelier's SOLO_ESO). */
export function editPrompt(instruction: string): string {
  const asked = instruction.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "").slice(0, 400);
  return `${asked}. Change only that and keep everything else exactly as it is in image 1: the same character, face, `
    + "pose, framing, art style, background and lighting.";
}
