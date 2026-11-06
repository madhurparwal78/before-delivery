/**
 * The single home of the saved-query language: its parser, its evaluator and
 * the value comparison used for sorting and grouping.
 */

import { addDaysToDate } from './homeclock';

export type FieldKind = 'text' | 'number' | 'date' | 'url' | 'select' | 'relation';

export type FieldSpec = {
  name: string;
  kind: FieldKind;
  options: string[] | null;
  targetTypeId: string | null;
};

export type TypeSpec = {
  id: string;
  name: string;
  fields: FieldSpec[];
};

export const QUERY_TEXT_MAX_CHARS = 500;
export const QUERY_MAX_NESTING = 8;

type LeftKind = FieldKind | '@title' | '@backlinks' | '@updated';

type Comparison = {
  kind: 'cmp';
  fieldName: string;
  display: string;
  left: LeftKind;
  field: FieldSpec | null;
  sub: { name: string; left: LeftKind; field: FieldSpec | null } | null;
  op: string;
  value: QueryValue;
};

type QueryValue =
  | { kind: 'string'; text: string }
  | { kind: 'number'; value: number }
  | { kind: 'date'; date: string }
  | { kind: 'today'; offsetDays: number }
  | { kind: 'null' };

export type Ast =
  | { kind: 'all' }
  | { kind: 'or'; left: Ast; right: Ast }
  | { kind: 'and'; left: Ast; right: Ast }
  | { kind: 'not'; inner: Ast }
  | Comparison;

type Token = {
  type:
    | 'identifier'
    | 'bracket'
    | 'at'
    | 'string'
    | 'number'
    | 'date'
    | 'keyword'
    | 'op'
    | 'lparen'
    | 'rparen'
    | 'dot'
    | 'plus'
    | 'minus';
  text: string;
  value: string;
  column: number;
};

class ParseFailure extends Error {
  constructor(public readonly detail: string) {
    super(detail);
  }
}

const KEYWORDS = new Set(['and', 'or', 'not', 'today', 'null']);

function tokenize(points: string[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const isLetter = (ch: string) => /[A-Za-z_]/.test(ch);
  const isWord = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  while (index < points.length) {
    const ch = points[index];
    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }
    const column = index + 1;
    if (ch === '(') {
      tokens.push({ type: 'lparen', text: '(', value: '(', column });
      index += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', text: ')', value: ')', column });
      index += 1;
      continue;
    }
    if (ch === '.') {
      tokens.push({ type: 'dot', text: '.', value: '.', column });
      index += 1;
      continue;
    }
    if (ch === '+') {
      tokens.push({ type: 'plus', text: '+', value: '+', column });
      index += 1;
      continue;
    }
    if (ch === '-') {
      tokens.push({ type: 'minus', text: '-', value: '-', column });
      index += 1;
      continue;
    }
    if (ch === '"') {
      let text = '';
      let cursor = index + 1;
      let closed = false;
      while (cursor < points.length) {
        const inner = points[cursor];
        if (inner === '\\') {
          const next = points[cursor + 1];
          if (next === '"' || next === '\\') {
            text += next;
            cursor += 2;
            continue;
          }
          text += inner;
          cursor += 1;
          continue;
        }
        if (inner === '"') {
          closed = true;
          cursor += 1;
          break;
        }
        text += inner;
        cursor += 1;
      }
      if (!closed) throw new ParseFailure(`Unclosed string at column ${column}.`);
      tokens.push({ type: 'string', text: points.slice(index, cursor).join(''), value: text, column });
      index = cursor;
      continue;
    }
    if (ch === '[') {
      let cursor = index + 1;
      let text = '';
      while (cursor < points.length && points[cursor] !== ']') {
        text += points[cursor];
        cursor += 1;
      }
      if (cursor >= points.length) {
        throw new ParseFailure(`Unexpected [ at column ${column}.`);
      }
      tokens.push({ type: 'bracket', text: `[${text}]`, value: text, column });
      index = cursor + 1;
      continue;
    }
    if (ch === '@') {
      let cursor = index + 1;
      let text = '';
      while (cursor < points.length && isWord(points[cursor])) {
        text += points[cursor];
        cursor += 1;
      }
      tokens.push({ type: 'at', text: `@${text}`, value: `@${text.toLowerCase()}`, column });
      index = cursor;
      continue;
    }
    if (ch === '=' || ch === '~' || ch === '<' || ch === '>' || ch === '!') {
      let text = ch;
      if ((ch === '<' || ch === '>' || ch === '!') && points[index + 1] === '=') text = `${ch}=`;
      if (ch === '!' && text === '!') throw new ParseFailure(`Unexpected ! at column ${column}.`);
      tokens.push({ type: 'op', text, value: text, column });
      index += text.length;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const dateMatch = /^\d{4}-\d{2}-\d{2}/.exec(points.slice(index, index + 10).join(''));
      if (dateMatch !== null && points.slice(index, index + 10).join('').length === 10) {
        const text = dateMatch[0];
        const nextCh = points[index + 10];
        if (nextCh === undefined || !isWord(nextCh)) {
          tokens.push({ type: 'date', text, value: text, column });
          index += 10;
          continue;
        }
      }
      let cursor = index;
      let text = '';
      while (cursor < points.length && /[0-9]/.test(points[cursor])) {
        text += points[cursor];
        cursor += 1;
      }
      if (points[cursor] === '.' && /[0-9]/.test(points[cursor + 1] ?? '')) {
        text += '.';
        cursor += 1;
        while (cursor < points.length && /[0-9]/.test(points[cursor])) {
          text += points[cursor];
          cursor += 1;
        }
      }
      if (points[cursor] === 'd' && !isWord(points[cursor + 1] ?? '')) {
        tokens.push({ type: 'number', text: `${text}d`, value: text, column });
        index = cursor + 1;
        continue;
      }
      tokens.push({ type: 'number', text, value: text, column });
      index = cursor;
      continue;
    }
    if (isLetter(ch)) {
      let cursor = index;
      let text = '';
      while (cursor < points.length && isWord(points[cursor])) {
        text += points[cursor];
        cursor += 1;
      }
      const lower = text.toLowerCase();
      tokens.push({
        type: KEYWORDS.has(lower) ? 'keyword' : 'identifier',
        text,
        value: lower,
        column,
      });
      index = cursor;
      continue;
    }
    throw new ParseFailure(`Unexpected ${ch} at column ${column}.`);
  }
  return tokens;
}

const OPS_BY_LEFT: Record<LeftKind, string[]> = {
  text: ['=', '!=', '~'],
  url: ['=', '!=', '~'],
  '@title': ['=', '!=', '~'],
  number: ['=', '!=', '<', '<=', '>', '>='],
  '@backlinks': ['=', '!=', '<', '<=', '>', '>='],
  date: ['=', '!=', '<', '<=', '>', '>='],
  '@updated': ['=', '!=', '<', '<=', '>', '>='],
  select: ['=', '!='],
  relation: ['=', '!='],
};

export type ParseResult = { ok: true; ast: Ast } | { ok: false; message: string };

export function parseQuery(text: string, type: TypeSpec, typeById: Map<string, TypeSpec>): ParseResult {
  const points = Array.from(text);
  if (points.length > QUERY_TEXT_MAX_CHARS) {
    return { ok: false, message: `Use at most ${QUERY_TEXT_MAX_CHARS} characters.` };
  }
  try {
    const tokens = tokenize(points);
    if (tokens.length === 0) return { ok: true, ast: { kind: 'all' } };
    const parser = new Parser(tokens, points.length, type, typeById);
    const ast = parser.parseOr(0);
    parser.expectEnd();
    return { ok: true, ast };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, message: error.detail };
    throw error;
  }
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly length: number,
    private readonly type: TypeSpec,
    private readonly typeById: Map<string, TypeSpec>,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    if (token === undefined) this.failEnd();
    this.index += 1;
    return token;
  }

  private failEnd(): never {
    throw new ParseFailure(`Unexpected end of query at column ${this.length + 1}.`);
  }

  private unexpected(token: Token): never {
    throw new ParseFailure(`Unexpected ${token.text} at column ${token.column}.`);
  }

  expectEnd(): void {
    const token = this.peek();
    if (token !== undefined) this.unexpected(token);
  }

  parseOr(depth: number): Ast {
    let left = this.parseAnd(depth);
    for (;;) {
      const token = this.peek();
      if (token === undefined || token.type !== 'keyword' || token.value !== 'or') return left;
      this.index += 1;
      const right = this.parseAnd(depth);
      left = { kind: 'or', left, right };
    }
  }

  parseAnd(depth: number): Ast {
    let left = this.parseNot(depth);
    for (;;) {
      const token = this.peek();
      if (token === undefined || token.type !== 'keyword' || token.value !== 'and') return left;
      this.index += 1;
      const right = this.parseNot(depth);
      left = { kind: 'and', left, right };
    }
  }

  parseNot(depth: number): Ast {
    const token = this.peek();
    if (token === undefined) this.failEnd();
    if (token.type === 'keyword' && token.value === 'not') {
      this.checkDepth(depth, token);
      this.index += 1;
      return { kind: 'not', inner: this.parseNot(depth + 1) };
    }
    if (token.type === 'lparen') {
      this.checkDepth(depth, token);
      this.index += 1;
      const inner = this.parseOr(depth + 1);
      const close = this.peek();
      if (close === undefined) this.failEnd();
      if (close.type !== 'rparen') this.unexpected(close);
      this.index += 1;
      return inner;
    }
    return this.parseComparison();
  }

  private checkDepth(depth: number, token: Token): void {
    if (depth >= QUERY_MAX_NESTING) {
      throw new ParseFailure(`Too deeply nested at column ${token.column}.`);
    }
  }

  private parseComparison(): Comparison {
    const nameToken = this.next();
    if (nameToken.type !== 'identifier' && nameToken.type !== 'bracket' && nameToken.type !== 'at') {
      this.unexpected(nameToken);
    }
    const first = this.resolveName(nameToken);
    let display = nameToken.type === 'bracket' ? nameToken.value : nameToken.text;
    let sub: Comparison['sub'] = null;
    const dot = this.peek();
    if (dot !== undefined && dot.type === 'dot') {
      this.index += 1;
      const subToken = this.next();
      if (subToken.type !== 'identifier' && subToken.type !== 'bracket' && subToken.type !== 'at') {
        this.unexpected(subToken);
      }
      if (first.left !== 'relation' || first.field === null || first.field.targetTypeId === null) {
        throw new ParseFailure(`Unknown field ${display}.${subToken.type === 'bracket' ? subToken.value : subToken.text} at column ${nameToken.column}.`);
      }
      const target = this.typeById.get(first.field.targetTypeId);
      const subName = subToken.type === 'bracket' ? subToken.value : subToken.text;
      display = `${display}.${subName}`;
      if (subToken.type === 'at') {
        if (subToken.value !== '@title') {
          throw new ParseFailure(`Unknown field ${display} at column ${subToken.column}.`);
        }
        sub = { name: '@title', left: '@title', field: null };
      } else {
        const field =
          target === undefined
            ? undefined
            : target.fields.find((candidate) => candidate.name.toLowerCase() === subName.toLowerCase());
        if (field === undefined) {
          throw new ParseFailure(`Unknown field ${display} at column ${subToken.column}.`);
        }
        sub = { name: field.name, left: field.kind, field };
      }
    }
    const opToken = this.peek();
    if (opToken === undefined) this.failEnd();
    if (opToken.type !== 'op') this.unexpected(opToken);
    this.index += 1;
    const effective = sub === null ? first : { left: sub.left, field: sub.field };
    const value = this.parseValue();
    if (value.kind === 'null') {
      if (opToken.value !== '=' && opToken.value !== '!=') {
        throw new ParseFailure(`${opToken.text} does not fit ${display} at column ${opToken.column}.`);
      }
    } else {
      const allowed = OPS_BY_LEFT[effective.left];
      if (!allowed.includes(opToken.value)) {
        throw new ParseFailure(`${opToken.text} does not fit ${display} at column ${opToken.column}.`);
      }
      this.checkValueKind(effective.left, effective.field, value, display);
    }
    return {
      kind: 'cmp',
      fieldName: first.name,
      display,
      left: first.left,
      field: first.field,
      sub,
      op: opToken.value,
      value,
    };
  }

  private checkValueKind(left: LeftKind, field: FieldSpec | null, value: QueryValue, display: string): void {
    const token = this.tokens[this.index - 1];
    const fail: () => never = () => this.unexpected(token);
    if (left === 'text' || left === 'url' || left === '@title' || left === 'relation') {
      if (value.kind !== 'string') fail();
      return;
    }
    if (left === 'number' || left === '@backlinks') {
      if (value.kind !== 'number') fail();
      return;
    }
    if (left === 'date' || left === '@updated') {
      if (value.kind !== 'date' && value.kind !== 'today') fail();
      return;
    }
    if (value.kind !== 'string') fail();
    const options = field?.options ?? [];
    const hit = options.some((option) => option.toLowerCase() === value.text.toLowerCase());
    if (!hit) {
      throw new ParseFailure(`"${value.text}" is not an option of ${display} at column ${token.column}.`);
    }
  }

  private parseValue(): QueryValue {
    const token = this.next();
    if (token.type === 'string') return { kind: 'string', text: token.value };
    if (token.type === 'number') return { kind: 'number', value: Number(token.value) };
    if (token.type === 'minus') {
      const digits = this.next();
      if (digits.type !== 'number') this.unexpected(digits);
      return { kind: 'number', value: -Number(digits.value) };
    }
    if (token.type === 'date') {
      if (!isRealDate(token.value)) {
        throw new ParseFailure(`Not a real date at column ${token.column}.`);
      }
      return { kind: 'date', date: token.value };
    }
    if (token.type === 'keyword' && token.value === 'null') return { kind: 'null' };
    if (token.type === 'keyword' && token.value === 'today') {
      const sign = this.peek();
      if (sign !== undefined && (sign.type === 'plus' || sign.type === 'minus')) {
        this.index += 1;
        const amount = this.next();
        if (amount.type !== 'number' || !amount.text.endsWith('d')) this.unexpected(amount);
        const days = Number(amount.value);
        return { kind: 'today', offsetDays: sign.type === 'minus' ? -days : days };
      }
      return { kind: 'today', offsetDays: 0 };
    }
    this.unexpected(token);
  }

  private resolveName(token: Token): { name: string; left: LeftKind; field: FieldSpec | null } {
    if (token.type === 'at') {
      if (token.value === '@title') return { name: '@title', left: '@title', field: null };
      if (token.value === '@backlinks') return { name: '@backlinks', left: '@backlinks', field: null };
      if (token.value === '@updated') return { name: '@updated', left: '@updated', field: null };
      throw new ParseFailure(`Unknown field ${token.text} at column ${token.column}.`);
    }
    const raw = token.type === 'bracket' ? token.value : token.text;
    const field = this.type.fields.find((candidate) => candidate.name.toLowerCase() === raw.toLowerCase());
    if (field === undefined) {
      throw new ParseFailure(`Unknown field ${raw} at column ${token.column}.`);
    }
    return { name: field.name, left: field.kind, field };
  }
}

export function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map((part) => Number(part));
  if (month < 1 || month > 12 || day < 1) return false;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= days;
}

/* ------------------------------------------------------------- evaluating */

export type EvalObject = {
  id: string;
  title: string;
  backlinks: number;
  updatedDate: string;
  properties: Record<string, unknown>;
};

export type EvalContext = {
  today: string;
  objectById: (id: string) => EvalObject | null;
  titleOf: (id: string) => string | null;
};

function lower(text: string): string {
  return text.toLowerCase();
}

export function compareText(a: string, b: string): number {
  const xs = Array.from(lower(a));
  const ys = Array.from(lower(b));
  const count = Math.min(xs.length, ys.length);
  for (let i = 0; i < count; i += 1) {
    const cx = xs[i].codePointAt(0) as number;
    const cy = ys[i].codePointAt(0) as number;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
  if (xs.length === ys.length) return 0;
  return xs.length < ys.length ? -1 : 1;
}

export type SortKind = FieldKind | '@title' | '@backlinks' | '@updated' | 'id';

export function compareValues(
  kind: SortKind,
  a: unknown,
  b: unknown,
  field: FieldSpec | null,
  titleOf: (id: string) => string | null,
): number {
  if (kind === 'select') {
    const options = field?.options ?? [];
    const ai = options.findIndex((option) => option === a);
    const bi = options.findIndex((option) => option === b);
    return ai === bi ? 0 : ai < bi ? -1 : 1;
  }
  if (kind === 'relation') {
    const at = typeof a === 'string' ? titleOf(a) ?? '' : '';
    const bt = typeof b === 'string' ? titleOf(b) ?? '' : '';
    return compareText(at, bt);
  }
  if (kind === 'number' || kind === '@backlinks') {
    const an = typeof a === 'number' ? a : 0;
    const bn = typeof b === 'number' ? b : 0;
    return an === bn ? 0 : an < bn ? -1 : 1;
  }
  if (kind === 'date' || kind === '@updated') {
    const as = typeof a === 'string' ? a : '';
    const bs = typeof b === 'string' ? b : '';
    return as === bs ? 0 : as < bs ? -1 : 1;
  }
  const as = typeof a === 'string' ? a : '';
  const bs = typeof b === 'string' ? b : '';
  return compareText(as, bs);
}

function valueOfLeft(
  object: EvalObject,
  left: LeftKind,
  name: string,
  context: EvalContext,
): unknown {
  if (left === '@title') return object.title;
  if (left === '@backlinks') return object.backlinks;
  if (left === '@updated') return object.updatedDate;
  const value = object.properties[name];
  return value === undefined ? null : value;
}

export function evaluate(ast: Ast, object: EvalObject, context: EvalContext): boolean {
  if (ast.kind === 'all') return true;
  if (ast.kind === 'or') return evaluate(ast.left, object, context) || evaluate(ast.right, object, context);
  if (ast.kind === 'and') return evaluate(ast.left, object, context) && evaluate(ast.right, object, context);
  if (ast.kind === 'not') return !evaluate(ast.inner, object, context);
  return evaluateComparison(ast, object, context);
}

function evaluateComparison(cmp: Comparison, object: EvalObject, context: EvalContext): boolean {
  let left: LeftKind = cmp.left;
  let field = cmp.field;
  let holder: EvalObject | null = object;
  let raw = valueOfLeft(object, cmp.left, cmp.fieldName, context);
  if (cmp.sub !== null) {
    const targetId = typeof raw === 'string' ? raw : null;
    holder = targetId === null ? null : context.objectById(targetId);
    if (holder === null) raw = null;
    else raw = valueOfLeft(holder, cmp.sub.left, cmp.sub.name, context);
    left = cmp.sub.left;
    field = cmp.sub.field;
  }
  if (cmp.value.kind === 'null') {
    const isNull = raw === null || raw === undefined;
    return cmp.op === '=' ? isNull : !isNull;
  }
  if (raw === null || raw === undefined) return false;
  if (left === 'relation') {
    const title = typeof raw === 'string' ? context.titleOf(raw) : null;
    if (title === null) return false;
    const wanted = cmp.value.kind === 'string' ? cmp.value.text : '';
    const equal = lower(title) === lower(wanted);
    return cmp.op === '=' ? equal : !equal;
  }
  if (left === 'text' || left === 'url' || left === '@title' || left === 'select') {
    const text = typeof raw === 'string' ? raw : String(raw);
    const wanted = cmp.value.kind === 'string' ? cmp.value.text : '';
    if (cmp.op === '~') return lower(text).includes(lower(wanted));
    const equal = lower(text) === lower(wanted);
    return cmp.op === '=' ? equal : !equal;
  }
  if (left === 'number' || left === '@backlinks') {
    const number = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(number)) return false;
    const wanted = cmp.value.kind === 'number' ? cmp.value.value : 0;
    return compareNumbers(cmp.op, number, wanted);
  }
  const date = typeof raw === 'string' ? raw : '';
  const wanted =
    cmp.value.kind === 'date'
      ? cmp.value.date
      : cmp.value.kind === 'today'
        ? addDaysToDate(context.today, cmp.value.offsetDays)
        : '';
  return compareStrings(cmp.op, date, wanted);
}

function compareNumbers(op: string, a: number, b: number): boolean {
  switch (op) {
    case '=':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    default:
      return a >= b;
  }
}

function compareStrings(op: string, a: string, b: string): boolean {
  switch (op) {
    case '=':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    default:
      return a >= b;
  }
}
