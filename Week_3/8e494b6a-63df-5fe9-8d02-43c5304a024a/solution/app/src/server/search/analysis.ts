// Text analysis (Business rules D): three analyzers, written here with no search library.
export type Analyzer = "standard" | "keyword" | "whitespace";
export const ANALYZERS: Analyzer[] = ["standard", "keyword", "whitespace"];

export interface Token {
  token: string;
  position: number;
  start: number;
  end: number;
}

const STOPWORDS = new Set("a an and are as at be but by for from in is it of on or that the to was with".split(" "));

/** Suffix table, tried in order; the first row that ends the token and leaves at least 3 characters applies. */
const SUFFIXES: Array<{ suffix: string; replacement: string }> = [
  { suffix: "ies", replacement: "y" },
  { suffix: "ing", replacement: "" },
  { suffix: "ed", replacement: "" },
  { suffix: "es", replacement: "" },
  { suffix: "s", replacement: "" },
];

function stem(word: string): string {
  for (const { suffix, replacement } of SUFFIXES) {
    if (word.endsWith(suffix)) {
      const stemmed = word.slice(0, word.length - suffix.length) + replacement;
      if (stemmed.length >= 3) return stemmed;
    }
  }
  return word;
}

const SURROGATE = /[\ud800-\udfff]/;

/** Converts a UTF-16 index into a character (code point) offset. */
function characterOffset(text: string, index: number): number {
  return SURROGATE.test(text) ? Array.from(text.slice(0, index)).length : index;
}

function runs(text: string, pattern: RegExp): Array<{ value: string; start: number; end: number }> {
  const found: Array<{ value: string; start: number; end: number }> = [];
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    found.push({ value: match[0], start: characterOffset(text, index), end: characterOffset(text, index + match[0].length) });
  }
  return found;
}

export function analyze(analyzer: Analyzer, text: string): Token[] {
  if (analyzer === "keyword") return [{ token: text, position: 0, start: 0, end: Array.from(text).length }];
  if (analyzer === "whitespace") {
    return runs(text, /\S+/g).map((run, position) => ({ token: run.value, position, start: run.start, end: run.end }));
  }
  const tokens: Token[] = [];
  runs(text, /[A-Za-z0-9]+/g).forEach((run, position) => {
    const lower = run.value.toLowerCase();
    if (!STOPWORDS.has(lower)) tokens.push({ token: stem(lower), position, start: run.start, end: run.end });
  });
  return tokens;
}

/** The number of runs the standard analyzer saw, stopwords included: where the next value's positions begin. */
export function positionSpan(analyzer: Analyzer, text: string): number {
  if (analyzer === "keyword") return 1;
  return runs(text, analyzer === "whitespace" ? /\S+/g : /[A-Za-z0-9]+/g).length;
}
