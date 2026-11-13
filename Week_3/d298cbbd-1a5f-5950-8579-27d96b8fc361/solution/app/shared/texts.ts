/** The only typing texts the app ships: the holloway-120 word list and the six quotes, plus the rules that turn them into a ticket's words. */

const WORD_LIST: readonly string[] = (
  "amber anchor apple arch ash attic badge barley basin beacon bell bench birch blade bloom bolt bramble brick bridge brook " +
  "cabin candle canal cedar chalk cider cliff clover cobble comet copper coral cotton crane crest dawn delta ditch dove drift " +
  "dune ember fable fern ferry field flint forge frost garden glade gravel harbor hazel heath hedge hollow honey inlet island " +
  "ivory jetty kettle lantern larch ledge linen lodge maple marsh meadow mill mist moss nectar oak orchard otter paddle pebble " +
  "pine plume quarry quill rain reed ridge river robin saddle sail shore slate spruce stone stream thistle timber tide trail " +
  "valley velvet willow wren yarrow acorn barrow canopy dusk elm fjord grove hamlet iris juniper kiln lark moor nook pond"
).split(" ");

export type QuoteGroup = "short" | "medium" | "long";
export type QuoteId = "q1" | "q2" | "q3" | "q4" | "q5" | "q6";

interface Quote {
  readonly id: QuoteId;
  readonly group: QuoteGroup;
  readonly text: string;
  readonly source: string;
}

export const QUOTES: readonly Quote[] = [
  { id: "q1", group: "short", text: "Brevity is the soul of wit.", source: "William Shakespeare, Hamlet (1603)" },
  { id: "q2", group: "short", text: "Beware; for I am fearless, and therefore powerful.", source: "Mary Shelley, Frankenstein (1818)" },
  { id: "q3", group: "medium", text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.", source: "Jane Austen, Pride and Prejudice (1813)" },
  { id: "q4", group: "medium", text: "I went to the woods because I wished to live deliberately, to front only the essential facts of life.", source: "Henry David Thoreau, Walden (1854)" },
  { id: "q5", group: "long", text: "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.", source: "Charles Dickens, A Tale of Two Cities (1859)" },
  { id: "q6", group: "long", text: "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it.", source: "Lewis Carroll, Alice's Adventures in Wonderland (1865)" },
];

export const CUSTOM_MAX_CHARACTERS = 2000;
export const CUSTOM_MAX_WORDS = 400;

type Mulberry = () => number;

function mulberry32(seed: number): Mulberry {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateWords(seed: number, count: number, punctuation: boolean, numbers: boolean): string[] {
  const draw = mulberry32(seed);
  const words: string[] = [];
  let previous = "";
  for (let i = 0; i < count; i++) {
    let word: string;
    do {
      word = WORD_LIST[Math.floor(draw() * WORD_LIST.length)]!;
    } while (word === previous);
    previous = word;
    if (numbers && draw() < 0.15) word = String(Math.floor(draw() * 1000));
    if (punctuation) {
      const y = draw();
      if (y < 0.1) word += ",";
      else if (y < 0.2) word += ".";
      if (i === 0 || words[i - 1]!.endsWith(".")) word = word.charAt(0).toUpperCase() + word.slice(1);
    }
    words.push(word);
  }
  return words;
}

/** The quote a ticket picks with its seed's first draw; `all` draws from the six in id order. */
export function pickQuote(seed: number, group: QuoteGroup | "all"): Quote {
  const pool = group === "all" ? QUOTES : QUOTES.filter((quote) => quote.group === group);
  return pool[Math.floor(mulberry32(seed)() * pool.length)]!;
}

interface CustomCount {
  readonly text: string;
  readonly characters: number;
  readonly words: number;
}

/** Runs of whitespace collapse to one space and the text is trimmed; characters are code points. */
export function countCustomText(raw: string): CustomCount {
  const text = raw.replace(/\s+/g, " ").trim();
  return { text, characters: [...text].length, words: text === "" ? 0 : text.split(" ").length };
}

export function customOverLimit(count: CustomCount): boolean {
  return count.characters > CUSTOM_MAX_CHARACTERS || count.words > CUSTOM_MAX_WORDS;
}
