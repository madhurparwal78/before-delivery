// Tokens of the calculation language, read one at a time in a single left-to-right pass.

export interface Pos {
  line: number;
  column: number;
}

export type TokenKind =
  | 'number'
  | 'string'
  | 'field'
  | 'param'
  | 'name'
  | 'op'
  | '('
  | ')'
  | '{'
  | '}'
  | ','
  | ':'
  /** a character no token starts with */
  | 'bad'
  /** a string or bracket left open: the formula ended early */
  | 'open'
  | 'end';

export interface Token {
  kind: TokenKind;
  /** the token as written */
  text: string;
  /** a string literal's value, a field or parameter name, or a name */
  value: string;
  pos: Pos;
  /** offsets into the formula text */
  start: number;
  stop: number;
}

const OPERATORS = ['<=', '>=', '<>', '=', '<', '>', '+', '-', '&', '*', '/', '%'];
const PUNCTUATION = new Set(['(', ')', '{', '}', ',', ':']);

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isNameStart = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isNamePart = (c: number): boolean => isNameStart(c) || isDigit(c);

export class Lexer {
  private offset = 0;
  private line = 1;
  private lineStart = 0;
  /** the next line break at or after `offset`, or the text length when there is none */
  private nextBreak: number;

  constructor(readonly text: string) {
    this.nextBreak = this.breakFrom(0);
  }

  private breakFrom(at: number): number {
    const found = this.text.indexOf('\n', at);
    return found === -1 ? this.text.length : found;
  }

  /** The position just after the last character. */
  endPos(): Pos {
    this.advanceTo(this.text.length);
    return { line: this.line, column: this.text.length - this.lineStart + 1 };
  }

  next(): Token {
    this.skipSpace();
    const text = this.text;
    const start = this.offset;
    const pos = { line: this.line, column: start - this.lineStart + 1 };
    if (start >= text.length) return this.token('end', start, start, '', pos);
    const c = text.charCodeAt(start);
    if (isDigit(c)) {
      let i = start + 1;
      while (i < text.length && isDigit(text.charCodeAt(i))) i++;
      if (text.charCodeAt(i) === 46 && isDigit(text.charCodeAt(i + 1))) {
        i += 2;
        while (i < text.length && isDigit(text.charCodeAt(i))) i++;
      }
      return this.token('number', start, i, text.slice(start, i), pos);
    }
    if (isNameStart(c)) {
      let i = start + 1;
      while (i < text.length && isNamePart(text.charCodeAt(i))) i++;
      return this.token('name', start, i, text.slice(start, i), pos);
    }
    if (c === 39) return this.stringToken(start, pos);
    if (c === 91) {
      const close = text.indexOf(']', start + 1);
      if (close === -1) return this.token('open', start, text.length, '', pos);
      const inner = text.slice(start + 1, close);
      const param = inner.startsWith('@');
      return this.token(param ? 'param' : 'field', start, close + 1, param ? inner.slice(1) : inner, pos);
    }
    const ch = text[start] ?? '';
    if (PUNCTUATION.has(ch)) return this.token(ch as TokenKind, start, start + 1, ch, pos);
    const op = OPERATORS.find((o) => text.startsWith(o, start));
    if (op) return this.token('op', start, start + op.length, op, pos);
    const point = String.fromCodePoint(text.codePointAt(start) ?? c);
    return this.token('bad', start, start + point.length, point, pos);
  }

  private stringToken(start: number, pos: Pos): Token {
    const text = this.text;
    let value = '';
    let i = start + 1;
    for (;;) {
      const close = text.indexOf("'", i);
      if (close === -1) return this.token('open', start, text.length, '', pos);
      value += text.slice(i, close);
      if (text.charCodeAt(close + 1) === 39) {
        value += "'";
        i = close + 2;
      } else {
        return this.token('string', start, close + 1, value, pos);
      }
    }
  }

  private token(kind: TokenKind, start: number, stop: number, value: string, pos: Pos): Token {
    this.advanceTo(stop);
    return { kind, text: this.text.slice(start, stop), value, pos, start, stop };
  }

  /** Moves the offset forward, counting the line breaks passed; each line break is found once. */
  private advanceTo(stop: number): void {
    while (this.nextBreak < stop) {
      this.line++;
      this.lineStart = this.nextBreak + 1;
      this.nextBreak = this.breakFrom(this.nextBreak + 1);
    }
    this.offset = Math.max(this.offset, stop);
  }

  private skipSpace(): void {
    const text = this.text;
    let i = this.offset;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
      i++;
    }
    this.advanceTo(i);
  }
}
