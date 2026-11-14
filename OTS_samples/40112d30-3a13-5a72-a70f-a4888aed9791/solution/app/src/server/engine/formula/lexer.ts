import { atColumn, Refusal } from './refusal.ts';

export type Token =
  | { kind: 'number'; text: string; column: number }
  | { kind: 'text'; text: string; value: string; column: number }
  | { kind: 'reference'; text: string; key: string; row: string | null; column: number }
  | { kind: 'word'; text: string; column: number }
  | { kind: 'symbol'; text: string; column: number };

export interface Tokens {
  tokens: Token[];
  /** The column just past the last character. */
  endColumn: number;
}

const SYMBOLS = ['<>', '<=', '>=', '+', '-', '*', '/', '%', '^', '&', '=', '<', '>', '(', ')', ','];

const isDigit = (char: string | undefined): boolean => char !== undefined && char >= '0' && char <= '9';
const isLetter = (char: string | undefined): boolean => char !== undefined && /^[A-Za-z]$/.test(char);
const isKeyStart = (char: string | undefined): boolean => char !== undefined && char >= 'a' && char <= 'z';
const isKeyPart = (char: string | undefined): boolean => isKeyStart(char) || isDigit(char) || char === '_';

/** Reads the whole text into tokens, refusing the first character that belongs to no token. */
export function lex(source: string): Tokens {
  const chars = Array.from(source);
  const tokens: Token[] = [];
  let index = 0;

  const slice = (from: number, to: number): string => chars.slice(from, to).join('');
  const readWhile = (from: number, accept: (char: string | undefined) => boolean): number => {
    let end = from;
    while (accept(chars[end])) end += 1;
    return end;
  };
  const readKey = (from: number): number | null =>
    isKeyStart(chars[from]) ? readWhile(from + 1, isKeyPart) : null;

  /** Reads `{key}` or `{key.row}` starting at the brace; null when it is not one. */
  const readReference = (start: number): Token | null => {
    const keyEnd = readKey(start + 1);
    if (keyEnd === null) return null;
    const key = slice(start + 1, keyEnd);
    const rowEnd = chars[keyEnd] === '.' ? readKey(keyEnd + 1) : null;
    const closeAt = rowEnd ?? keyEnd;
    if (chars[closeAt] !== '}') return null;
    return {
      kind: 'reference', text: slice(start, closeAt + 1), key,
      row: rowEnd === null ? null : slice(keyEnd + 1, rowEnd), column: start + 1,
    };
  };

  while (index < chars.length) {
    const char = chars[index] ?? '';
    const column = index + 1;
    if (/^\s$/.test(char)) {
      index += 1;
    } else if (isDigit(char)) {
      let end = readWhile(index, isDigit);
      if (chars[end] === '.' && isDigit(chars[end + 1])) end = readWhile(end + 1, isDigit);
      tokens.push({ kind: 'number', text: slice(index, end), column });
      index = end;
    } else if (isLetter(char)) {
      const end = readWhile(index, (next) => isLetter(next) || isDigit(next) || next === '_');
      tokens.push({ kind: 'word', text: slice(index, end), column });
      index = end;
    } else if (char === '"') {
      const close = chars.indexOf('"', index + 1);
      if (close === -1) throw new Refusal(atColumn(column, 'this text has no closing quote.'));
      tokens.push({ kind: 'text', text: slice(index, close + 1), value: slice(index + 1, close), column });
      index = close + 1;
    } else if (char === '{') {
      const reference = readReference(index);
      if (reference === null) throw new Refusal(atColumn(column, `unexpected character ${char}.`));
      tokens.push(reference);
      index += Array.from(reference.text).length;
    } else {
      const symbol = SYMBOLS.find((candidate) => slice(index, index + candidate.length) === candidate);
      if (symbol === undefined) throw new Refusal(atColumn(column, `unexpected character ${char}.`));
      tokens.push({ kind: 'symbol', text: symbol, column });
      index += symbol.length;
    }
  }
  return { tokens, endColumn: chars.length + 1 };
}
