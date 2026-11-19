/**
 * Tokens of the published expression language. Columns count from 1 over the
 * whole expression text, trailing spaces included.
 */

export type TokenKind = 'number' | 'string' | 'ident' | 'punct' | 'eof';

export interface Token {
  readonly kind: TokenKind;
  /** The source text of the token, used in `unexpected "<token>"`. */
  readonly text: string;
  /** Parsed value for numbers and strings. */
  readonly value?: number | string;
  /** 1-based column of the token's first character. */
  readonly col: number;
}

export class ExpressionSyntaxError extends Error {
  constructor(
    readonly col: number,
    readonly reason: string,
  ) {
    super(`Expression error at column ${col}: ${reason}.`);
    this.name = 'ExpressionSyntaxError';
  }
}

const punctuation = ['<=', '>=', '!=', '=', '<', '>', '(', ')', '[', ']', ',', '+', '-', '*', '/', '.'];

const identStart = /[A-Za-z_]/;
const identPart = /[A-Za-z0-9_]/;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    const col = i + 1;
    if (ch === '"') {
      const start = i;
      i += 1;
      let out = '';
      let closed = false;
      while (i < text.length) {
        const c = text[i];
        if (c === '\\') {
          const next = text[i + 1];
          if (next === '"' || next === '\\') {
            out += next;
            i += 2;
            continue;
          }
          out += c;
          i += 1;
          continue;
        }
        if (c === '"') {
          i += 1;
          closed = true;
          break;
        }
        out += c;
        i += 1;
      }
      if (!closed) throw new ExpressionSyntaxError(start + 1, 'unexpected """');
      tokens.push({ kind: 'string', text: text.slice(start, i), value: out, col });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < text.length && /[0-9]/.test(text[i])) i += 1;
      if (text[i] === '.' && /[0-9]/.test(text[i + 1] ?? '')) {
        i += 1;
        while (i < text.length && /[0-9]/.test(text[i])) i += 1;
      }
      const raw = text.slice(start, i);
      tokens.push({ kind: 'number', text: raw, value: Number(raw), col });
      continue;
    }
    if (identStart.test(ch)) {
      const start = i;
      while (i < text.length && identPart.test(text[i])) i += 1;
      tokens.push({ kind: 'ident', text: text.slice(start, i), col });
      continue;
    }
    const punct = punctuation.find((p) => text.startsWith(p, i));
    if (punct) {
      tokens.push({ kind: 'punct', text: punct, col });
      i += punct.length;
      continue;
    }
    throw new ExpressionSyntaxError(col, `unexpected "${ch}"`);
  }
  tokens.push({ kind: 'eof', text: '', col: text.length + 1 });
  return tokens;
}
