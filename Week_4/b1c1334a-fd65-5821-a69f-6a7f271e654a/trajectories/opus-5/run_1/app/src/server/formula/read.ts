import { parseDecimalText, type Dec } from '../decimal.js';
import { copy } from '../../shared/copy.js';

export const MAX_FORMULA_LENGTH = 2000;

export type Diagnosis =
  | { kind: 'unreadable'; position: number }
  | { kind: 'ended_early' }
  | { kind: 'too_long' };

export function diagnosisMessage(diagnosis: Diagnosis): string {
  switch (diagnosis.kind) {
    case 'unreadable':
      return copy.formulaUnreadable(diagnosis.position);
    case 'ended_early':
      return copy.formulaEndedEarly;
    case 'too_long':
      return copy.formulaTooLong;
  }
}

export type BinaryOperator = '*' | '/' | '+' | '-' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

/** A name in the formula text, with the span of the name itself inside the stored text. */
export type NamePart = { name: string; start: number; end: number };

export type Expr =
  | { k: 'number'; value: Dec }
  | { k: 'string'; value: string }
  | { k: 'bool'; value: boolean }
  | { k: 'field'; path: NamePart[] }
  | { k: 'unary'; expr: Expr }
  | { k: 'binary'; op: BinaryOperator; left: Expr; right: Expr }
  | { k: 'call'; name: string; args: Argument[] };

export type Argument =
  | { k: 'expr'; expr: Expr }
  | { k: 'table'; table: NamePart }
  | { k: 'tableColumn'; table: NamePart; column: NamePart };

export type ReadResult = { ok: true; text: string; expr: Expr } | { ok: false; diagnosis: Diagnosis };

type TokenBody =
  | { t: 'number'; value: Dec }
  | { t: 'string'; value: string }
  | { t: 'name'; value: string }
  | { t: 'bracket'; value: string }
  | { t: 'op'; value: BinaryOperator }
  | { t: 'punct'; value: '(' | ')' | ',' | '.' }
  | { t: 'bad' }
  | { t: 'end' };

type Token = TokenBody & { pos: number; start: number; end: number };

class ReadError extends Error {
  constructor(readonly diagnosis: Diagnosis) {
    super('formula could not be read');
  }
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isLetter = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));

function tokenise(chars: string[], offset: number): Token[] {
  const utf16At: number[] = [0];
  for (const c of chars) utf16At.push((utf16At[utf16At.length - 1] as number) + c.length);

  const tokens: Token[] = [];
  let i = 0;
  const span = (startIndex: number, endIndex: number) => ({
    pos: startIndex + 1 + offset,
    start: utf16At[startIndex] as number,
    end: utf16At[endIndex] as number,
  });

  while (i < chars.length) {
    const c = chars[i] as string;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i += 1;
      continue;
    }
    const start = i;
    if (isDigit(c)) {
      let text = '';
      while (isDigit(chars[i])) {
        text += chars[i] as string;
        i += 1;
      }
      if (chars[i] === '.' && isDigit(chars[i + 1])) {
        text += '.';
        i += 1;
        while (isDigit(chars[i])) {
          text += chars[i] as string;
          i += 1;
        }
      }
      const value = parseDecimalText(text);
      if (value === null) {
        tokens.push({ t: 'bad', ...span(start, i) });
        break;
      }
      tokens.push({ t: 'number', value, ...span(start, i) });
      continue;
    }
    if (c === '"') {
      i += 1;
      let value = '';
      let closed = false;
      while (i < chars.length) {
        const ch = chars[i] as string;
        if (ch === '"') {
          if (chars[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        value += ch;
        i += 1;
      }
      if (!closed) {
        tokens.push({ t: 'bad', ...span(start, i) });
        break;
      }
      tokens.push({ t: 'string', value, ...span(start, i) });
      continue;
    }
    if (c === '[') {
      i += 1;
      let value = '';
      let closed = false;
      while (i < chars.length) {
        const ch = chars[i] as string;
        if (ch === ']') {
          i += 1;
          closed = true;
          break;
        }
        if (ch === '[') break;
        value += ch;
        i += 1;
      }
      if (!closed || value.length === 0) {
        tokens.push({ t: 'bad', ...span(start, i) });
        break;
      }
      tokens.push({ t: 'bracket', value, ...span(start, i) });
      continue;
    }
    if (isLetter(c)) {
      let value = '';
      while (isLetter(chars[i]) || isDigit(chars[i]) || chars[i] === '_') {
        value += chars[i] as string;
        i += 1;
      }
      tokens.push({ t: 'name', value, ...span(start, i) });
      continue;
    }
    if (c === '.') {
      if (isDigit(chars[i + 1]) || chars[i + 1] === '[') {
        i += 1;
        tokens.push({ t: 'punct', value: '.', ...span(start, i) });
        continue;
      }
      tokens.push({ t: 'bad', ...span(start, i + 1) });
      break;
    }
    if (c === '<') {
      const next = chars[i + 1];
      if (next === '>' || next === '=') {
        i += 2;
        tokens.push({ t: 'op', value: next === '>' ? '<>' : '<=', ...span(start, i) });
        continue;
      }
      i += 1;
      tokens.push({ t: 'op', value: '<', ...span(start, i) });
      continue;
    }
    if (c === '>') {
      if (chars[i + 1] === '=') {
        i += 2;
        tokens.push({ t: 'op', value: '>=', ...span(start, i) });
        continue;
      }
      i += 1;
      tokens.push({ t: 'op', value: '>', ...span(start, i) });
      continue;
    }
    if (c === '*' || c === '/' || c === '+' || c === '-' || c === '&' || c === '=') {
      i += 1;
      tokens.push({ t: 'op', value: c, ...span(start, i) });
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      i += 1;
      tokens.push({ t: 'punct', value: c, ...span(start, i) });
      continue;
    }
    tokens.push({ t: 'bad', ...span(start, i + 1) });
    break;
  }
  tokens.push({ t: 'end', ...span(chars.length, chars.length) });
  return tokens;
}

const SINGLE_COLUMN_AGGREGATES = new Set(['sum', 'min', 'max', 'average', 'countby']);

function tableSlot(functionName: string, index: number): 'table' | 'tableColumn' | 'none' {
  const fn = functionName.toLowerCase();
  if (fn === 'count') return index === 0 ? 'table' : 'none';
  if (fn === 'sumby') return index <= 1 ? 'tableColumn' : 'none';
  if (SINGLE_COLUMN_AGGREGATES.has(fn)) return index === 0 ? 'tableColumn' : 'none';
  return 'none';
}

function endsArgument(token: Token): boolean {
  return token.t === 'punct' && (token.value === ',' || token.value === ')');
}

function plainName(token: Token & { t: 'name' }): NamePart {
  return { name: token.value, start: token.start, end: token.end };
}

function bracketName(token: Token & { t: 'bracket' }): NamePart {
  return { name: token.value, start: token.start + 1, end: token.end - 1 };
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(ahead = 0): Token {
    return this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)] as Token;
  }

  private take(): Token {
    const token = this.peek();
    this.rejectTerminal(token);
    this.index += 1;
    return token;
  }

  private rejectTerminal(token: Token): void {
    if (token.t === 'bad') throw new ReadError({ kind: 'unreadable', position: token.pos });
    if (token.t === 'end') throw new ReadError({ kind: 'ended_early' });
  }

  private reject(token: Token): never {
    this.rejectTerminal(token);
    throw new ReadError({ kind: 'unreadable', position: token.pos });
  }

  parseWhole(): Expr {
    const expr = this.parseExpr();
    const next = this.peek();
    if (next.t !== 'end') this.reject(next);
    return expr;
  }

  parseExpr(): Expr {
    let left = this.parseConcat();
    for (;;) {
      const token = this.peek();
      if (
        token.t === 'op' &&
        (token.value === '=' ||
          token.value === '<>' ||
          token.value === '<' ||
          token.value === '>' ||
          token.value === '<=' ||
          token.value === '>=')
      ) {
        this.index += 1;
        left = { k: 'binary', op: token.value, left, right: this.parseConcat() };
        continue;
      }
      return left;
    }
  }

  private parseConcat(): Expr {
    let left = this.parseAdditive();
    for (;;) {
      const token = this.peek();
      if (token.t === 'op' && token.value === '&') {
        this.index += 1;
        left = { k: 'binary', op: '&', left, right: this.parseAdditive() };
        continue;
      }
      return left;
    }
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    for (;;) {
      const token = this.peek();
      if (token.t === 'op' && (token.value === '+' || token.value === '-')) {
        this.index += 1;
        left = { k: 'binary', op: token.value, left, right: this.parseMultiplicative() };
        continue;
      }
      return left;
    }
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token.t === 'op' && (token.value === '*' || token.value === '/')) {
        this.index += 1;
        left = { k: 'binary', op: token.value, left, right: this.parseUnary() };
        continue;
      }
      return left;
    }
  }

  private parseUnary(): Expr {
    const token = this.peek();
    if (token.t === 'op' && token.value === '-') {
      this.index += 1;
      return { k: 'unary', expr: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const token = this.take();
    if (token.t === 'number') return { k: 'number', value: token.value };
    if (token.t === 'string') return { k: 'string', value: token.value };
    if (token.t === 'bracket') return { k: 'field', path: this.parseFieldPath(bracketName(token)) };
    if (token.t === 'punct' && token.value === '(') {
      const expr = this.parseExpr();
      const close = this.take();
      if (close.t !== 'punct' || close.value !== ')') this.reject(close);
      return expr;
    }
    if (token.t === 'name') {
      const next = this.peek();
      if (next.t === 'punct' && next.value === '(') return this.parseCall(token.value);
      const lower = token.value.toLowerCase();
      if (lower === 'true') return { k: 'bool', value: true };
      if (lower === 'false') return { k: 'bool', value: false };
      throw new ReadError({ kind: 'unreadable', position: token.pos });
    }
    this.reject(token);
  }

  private parseFieldPath(first: NamePart): NamePart[] {
    const path = [first];
    for (;;) {
      const dot = this.peek();
      const after = this.peek(1);
      if (dot.t === 'punct' && dot.value === '.' && after.t === 'bracket') {
        this.index += 2;
        path.push(bracketName(after));
        continue;
      }
      return path;
    }
  }

  private parseCall(functionName: string): Expr {
    this.index += 1;
    const args: Argument[] = [];
    const first = this.peek();
    if (first.t === 'punct' && first.value === ')') {
      this.index += 1;
      return { k: 'call', name: functionName, args };
    }
    for (;;) {
      args.push(this.parseArgument(functionName, args.length));
      const separator = this.take();
      if (separator.t === 'punct' && separator.value === ',') continue;
      if (separator.t === 'punct' && separator.value === ')') {
        return { k: 'call', name: functionName, args };
      }
      this.reject(separator);
    }
  }

  private parseArgument(functionName: string, index: number): Argument {
    const slot = tableSlot(functionName, index);
    if (slot !== 'none') {
      const taken = this.tryTableArgument(slot);
      if (taken !== null) return taken;
    }
    return { k: 'expr', expr: this.parseExpr() };
  }

  /** A table name may be read only as the whole argument of an aggregate. */
  private tryTableArgument(slot: 'table' | 'tableColumn'): Argument | null {
    const name = this.peek();
    if (name.t !== 'name') return null;
    if (slot === 'table') {
      const after = this.peek(1);
      if (after.t === 'end') throw new ReadError({ kind: 'ended_early' });
      if (!endsArgument(after)) return null;
      this.index += 1;
      return { k: 'table', table: plainName(name) };
    }
    const dot = this.peek(1);
    const column = this.peek(2);
    if (dot.t !== 'punct' || dot.value !== '.' || column.t !== 'bracket') return null;
    const after = this.peek(3);
    if (after.t === 'end') throw new ReadError({ kind: 'ended_early' });
    if (!endsArgument(after)) return null;
    this.index += 3;
    return { k: 'tableColumn', table: plainName(name), column: bracketName(column) };
  }
}

/** Removes one leading equals sign, as every column save and preview does. */
export function stripEquals(sent: string): string {
  return sent.startsWith('=') ? sent.slice(1) : sent;
}

export function readFormula(sent: string): ReadResult {
  const stripped = stripEquals(sent);
  const offset = sent.length === stripped.length ? 0 : 1;
  const chars = Array.from(stripped);
  if (chars.length > MAX_FORMULA_LENGTH) return { ok: false, diagnosis: { kind: 'too_long' } };
  const tokens = tokenise(chars, offset);
  try {
    return { ok: true, text: stripped, expr: new Parser(tokens).parseWhole() };
  } catch (error) {
    if (error instanceof ReadError) return { ok: false, diagnosis: error.diagnosis };
    throw error;
  }
}
