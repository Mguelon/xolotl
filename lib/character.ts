/**
 * The character creator's options, step by step, and the words each one puts in the prompt.
 *
 * The steps are atelier's (api/core/personaje.py): the head first, then the body and its clothes drawn around that
 * head, and last the sheet the swap casts from. The options are buttons, as Higgsfield's AI Influencer Studio and Soul
 * Cast and Cheapsfield's «Criar influencer» do it, instead of a prompt to write. Labels come in both interface languages;
 * what the model reads is always English. The style templates are atelier's (api/core/muestras.py ESTILOS), measured
 * there with Qwen-Image 2.1 Turbo at about 12 s a head (2026-10-15); their previews in public/styles are that run's.
 */
import type { Lang } from "./i18n";

export type Step = "head" | "body" | "sheet";
export const STEPS: Step[] = ["head", "body", "sheet"];

type Words = { en: string; es: string };
export type Choice = Words & { id: string; say: string; swatch?: string };
type Base = Words & { id: string; hint?: Words };
export type Group =
  | (Base & { kind: "style"; choices: Choice[]; initial: string })
  | (Base & { kind: "one"; choices: Choice[]; initial?: string; swatches?: boolean; required?: boolean })
  | (Base & { kind: "many"; choices: Choice[]; max: number; swatches?: boolean })
  | (Base & { kind: "range"; min: number; max: number; initial: number; unit: Words })
  | (Base & { kind: "text"; placeholder: Words; line?: boolean });

export type Value = string | string[] | number;
export type Picks = Record<string, Value>;

export const word = (w: Words, lang: Lang) => w[lang];

/** The style templates; `{desc}` is who the character is. A head-and-shoulders portrait on a plain grey background. */
const STYLE_PROSE: Record<string, string> = {
  realista: "Close-up portrait photograph of {desc}. Head and shoulders, facing the camera with a neutral relaxed expression. Plain light grey seamless studio background, soft even studio lighting, sharp focus, realistic skin texture, natural proportions, 85mm lens, high-resolution photo.",
  cine: "Cinematic film still, close-up portrait of {desc}. Head and shoulders, facing the camera with a neutral expression. Dramatic moody key light with a soft rim light, shallow depth of field, subtle film grain, teal and amber color grading, anamorphic look, plain dark grey background, high-quality movie frame.",
  anime: "Anime illustration, close-up portrait of {desc}. Head and shoulders, facing the viewer with a calm neutral expression. Clean cel shading, crisp confident line art, large expressive eyes, detailed hair with highlights, plain light grey background, soft even lighting, high-quality anime key visual.",
  caricatura: "3D animated feature film character render, close-up portrait of {desc}. Head and shoulders, facing the camera with a friendly neutral expression. Stylized appealing proportions with a slightly larger head and big expressive eyes, smooth subsurface-scattering skin, soft studio lighting, plain light grey background, high-quality modern 3D animation render.",
  ilustracion: "Painted digital illustration, close-up portrait of {desc}. Head and shoulders, facing the viewer with a neutral expression. Expressive visible brushstrokes, rich layered color, painterly character concept art, plain light grey background, soft directional lighting, high quality.",
  comic: "American comic book illustration, close-up portrait of {desc}. Head and shoulders, facing the viewer with a neutral expression. Bold ink outlines, flat comic colors with halftone shading, dynamic inked details, plain light grey background, high-quality comic art.",
  acuarela: "Watercolor painting, close-up portrait of {desc}. Head and shoulders, facing the viewer with a neutral expression. Soft translucent washes, wet-on-wet blooms, visible paper texture, loose edges, plain light background, high-quality watercolor illustration.",
  plastilina: "Claymation stop-motion puppet, close-up portrait of {desc}. Head and shoulders, facing the camera with a neutral expression. Hand-sculpted modeling clay with fingerprints and subtle imperfections, matte clay texture, soft studio lighting, plain light grey background, high-quality stop-motion still.",
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
    { id: "style", kind: "style", en: "Style", es: "Estilo", choices: STYLE, initial: "realista" },
    { id: "gender", kind: "one", en: "Gender", es: "Género", required: true, initial: "woman", choices: [
      { id: "woman", en: "Woman", es: "Mujer", say: "woman" },
      { id: "man", en: "Man", es: "Hombre", say: "man" },
      { id: "androgynous", en: "Androgynous", es: "Andrógino", say: "androgynous person" },
    ] },
    { id: "age", kind: "range", en: "Age", es: "Edad", min: 18, max: 80, initial: 26, unit: { en: "years", es: "años" } },
    { id: "origin", kind: "many", en: "Origin", es: "Origen", max: 3,
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
    { id: "skin", kind: "one", en: "Skin", es: "Piel", swatches: true, choices: [
      { id: "very_fair", en: "Very fair", es: "Muy clara", say: "very fair skin", swatch: "oklch(91% 0.035 65)" },
      { id: "fair", en: "Fair", es: "Clara", say: "fair skin", swatch: "oklch(85% 0.05 62)" },
      { id: "medium", en: "Medium", es: "Media", say: "medium skin", swatch: "oklch(77% 0.07 60)" },
      { id: "olive", en: "Olive", es: "Aceitunada", say: "olive skin", swatch: "oklch(70% 0.07 78)" },
      { id: "tan", en: "Tan", es: "Morena clara", say: "tan skin", swatch: "oklch(63% 0.085 55)" },
      { id: "brown", en: "Brown", es: "Morena", say: "brown skin", swatch: "oklch(52% 0.08 50)" },
      { id: "dark", en: "Dark brown", es: "Oscura", say: "dark brown skin", swatch: "oklch(40% 0.065 45)" },
      { id: "deep", en: "Deep", es: "Muy oscura", say: "deep dark brown skin", swatch: "oklch(30% 0.045 40)" },
    ] },
    { id: "eyes", kind: "one", en: "Eyes", es: "Ojos", swatches: true, choices: [
      { id: "dark_brown", en: "Dark brown", es: "Café oscuro", say: "dark brown eyes", swatch: "oklch(30% 0.045 50)" },
      { id: "brown", en: "Brown", es: "Café", say: "brown eyes", swatch: "oklch(43% 0.075 55)" },
      { id: "amber", en: "Amber", es: "Ámbar", say: "amber eyes", swatch: "oklch(63% 0.13 70)" },
      { id: "hazel", en: "Hazel", es: "Avellana", say: "hazel eyes", swatch: "oklch(56% 0.08 95)" },
      { id: "green", en: "Green", es: "Verdes", say: "green eyes", swatch: "oklch(56% 0.1 150)" },
      { id: "blue", en: "Blue", es: "Azules", say: "blue eyes", swatch: "oklch(60% 0.11 245)" },
      { id: "grey", en: "Grey", es: "Grises", say: "grey eyes", swatch: "oklch(67% 0.02 240)" },
    ] },
    { id: "hair_cut", kind: "one", en: "Haircut", es: "Peinado", choices: HAIR_CUT },
    { id: "hair_texture", kind: "one", en: "Hair texture", es: "Textura del pelo", choices: [
      { id: "straight", en: "Straight", es: "Lacio", say: "straight" },
      { id: "wavy", en: "Wavy", es: "Ondulado", say: "wavy" },
      { id: "curly", en: "Curly", es: "Rizado", say: "curly" },
      { id: "coily", en: "Coily", es: "Muy rizado", say: "coily" },
    ] },
    { id: "hair_color", kind: "one", en: "Hair color", es: "Color del pelo", swatches: true, choices: [
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
    { id: "facial_hair", kind: "one", en: "Facial hair", es: "Vello facial", choices: [
      { id: "none", en: "None", es: "Sin vello", say: "clean-shaven" },
      { id: "stubble", en: "Stubble", es: "Barba de días", say: "light stubble" },
      { id: "short_beard", en: "Short beard", es: "Barba corta", say: "a short beard" },
      { id: "full_beard", en: "Full beard", es: "Barba completa", say: "a full beard" },
      { id: "mustache", en: "Mustache", es: "Bigote", say: "a mustache" },
      { id: "goatee", en: "Goatee", es: "Perilla", say: "a goatee" },
    ] },
    { id: "details", kind: "many", en: "Details", es: "Detalles", max: 4,
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
    { id: "extra", kind: "text", en: "Anything else", es: "Algo más",
      placeholder: { en: "e.g. thick eyebrows, a gap between the front teeth", es: "ej.: cejas gruesas, separación entre los dientes" } },
    { id: "count", kind: "one", en: "Heads to choose from", es: "Cabezas para escoger", required: true, initial: "4", choices: [
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

/** Measured in atelier (frontend/lib/personaje.ts, 2026-10-13 and 10-15): what each step usually takes on the A4000. */
export const SECONDS = { head: 12, headLoad: 20, body: 120, sheetSimple: 115, sheetFull: 720 };

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
export function describeHead(picks: Picks): string {
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
  const extra = text(picks.extra);
  return tidy(`an original, fictional ${age}-year-old ${gender}${origin}${traits.length ? ` with ${list(traits)}` : ""}${extra ? `, ${extra}` : ""}`);
}

/** The head's whole prompt: the style template with who the character is. */
export function headPrompt(picks: Picks): string {
  const style = typeof picks.style === "string" && STYLE_PROSE[picks.style] ? picks.style : "realista";
  return STYLE_PROSE[style].replace("{desc}", describeHead(picks));
}

/** The body around the head: build, height and clothes. Own words for the clothes win over the clothes style. */
export function describeBody(picks: Picks): string {
  const build = choiceOf("body", "build", picks.build)?.say;
  const height = choiceOf("body", "height", picks.height)?.say;
  const clothes = text(picks.clothes, 320) || choiceOf("body", "outfit", picks.outfit)?.say || "";
  const accessories = choicesOf("body", "accessories", picks.accessories).map((c) => c.say);
  const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
  const figure = height && build ? `${cap(height)}, with ${build}.` : height ? `${cap(height)}.` : build ? `${cap(build)}.` : "";
  return tidy([
    figure,
    clothes && `Wearing ${clothes}${accessories.length ? `, with ${list(accessories)}` : ""}.`,
    !clothes && accessories.length ? `With ${list(accessories)}.` : "",
  ].filter(Boolean).join(" "));
}

/** How many heads a round makes. */
export const headCount = (picks: Picks) => Math.max(1, Math.min(4, Number(picks.count) || 4));
