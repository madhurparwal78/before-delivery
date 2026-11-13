import type { FieldType } from "./types";

export const STOPWORDS = new Set(
  "a an and are as at be but by for from in is it of on or that the to was with".split(" "),
);

const SUFFIXES: [string, string][] = [
  ["ies", "y"],
  ["ing", ""],
  ["ed", ""],
  ["es", ""],
  ["s", ""],
];

export interface Token {
  token: string;
  position: number;
  start: number;
  end: number;
}

/** Suffix table: first row whose suffix ends the token leaving at least 3 characters applies. */
export function applySuffix(t: string): string {
  for (const [suffix, repl] of SUFFIXES) {
    if (t.length > suffix.length && t.endsWith(suffix)) {
      const out = t.slice(0, t.length - suffix.length) + repl;
      if (out.length >= 3) return out;
    }
  }
  return t;
}

export function standardTokens(value: string): Token[] {
  return standardTokensAll(value).filter((t) => !STOPWORDS.has(t.raw.toLowerCase()));
}

/** Analysed runs of the standard analyzer, keeping every position, stopwords included. */
export interface RunToken extends Token {
  raw: string;
}

export function standardTokensAll(value: string): RunToken[] {
  const tokens: RunToken[] = [];
  const re = /[A-Za-z0-9]+/g;
  let position = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const raw = m[0];
    tokens.push({
      raw,
      token: applySuffix(raw.toLowerCase()),
      position,
      start: m.index,
      end: m.index + raw.length,
    });
    position += 1;
  }
  return tokens;
}

export function keywordToken(value: string): Token[] {
  return [{ token: value, position: 0, start: 0, end: value.length }];
}

export function whitespaceTokens(value: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  let position = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    tokens.push({ token: m[0], position, start: m.index, end: m.index + m[0].length });
    position += 1;
  }
  return tokens;
}

export function analyze(analyzer: string, value: string): Token[] {
  if (typeof value !== "string") return [];
  if (analyzer === "keyword") return keywordToken(value);
  if (analyzer === "whitespace") return whitespaceTokens(value);
  return standardTokens(value);
}

export function analyzerFor(fieldType: FieldType): string {
  return fieldType === "text" ? "standard" : fieldType === "keyword" ? "keyword" : "standard";
}

/** Tokens that count toward a field length (stopwords dropped). */
export function fieldLengthTokens(value: string): Token[] {
  return standardTokens(value);
}
