// The query language (parser, checker, evaluator) and the value comparison used for sorting and
// grouping (Business rules: "Query language").

export type FieldKind = 'text' | 'number' | 'date' | 'url' | 'select' | 'relation';

export interface QueryField {
  name: string;
  kind: FieldKind;
  options: string[] | null;
  targetTypeId: string | null;
}

export interface QueryType {
  id: string;
  name: string;
  fields: QueryField[];
}

export interface QueryObject {
  id: string;
  title: string;
  typeId: string;
  backlinks: number;
  /** The object's `updated_at` as a date on the home clock, YYYY-MM-DD. */
  updatedDate: string;
  /** Stored property values by field name; a relation holds the target object id. */
  properties: Record<string, string | number | null>;
}

export interface QueryContext {
  /** Today on the home clock, YYYY-MM-DD. */
  today: string;
  typeById(id: string): QueryType | undefined;
  objectById(id: string): QueryObject | undefined;
}

/** Longest query text, in characters; exactly this many is allowed. */
export const QUERY_TEXT_CAP = 500;
const MAX_NESTING = 8;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Comparing values

/** Code point by code point; a prefix comes before the longer string. */
function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const shared = Math.min(x.length, y.length);
  for (let i = 0; i < shared; i++) {
    const diff = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return x.length - y.length;
}

/** Text, url and `@title`: lowercased, then compared code point by code point. */
export function compareText(a: string, b: string): number {
  return compareCodePoints(a.toLowerCase(), b.toLowerCase());
}

/** Ids: as lowercase strings, compared code point by code point. */
export function compareIds(a: string, b: string): number {
  return compareText(a, b);
}

// ---------------------------------------------------------------------------
// Subjects: what a path or sort key reads from an object

type Builtin = '@title' | '@backlinks' | '@updated';
const BUILTINS: readonly Builtin[] = ['@title', '@backlinks', '@updated'];

type Subject = { builtin: Builtin } | { field: QueryField };

/** The comparison family a subject belongs to. */
type ValueKind = 'text' | 'number' | 'date' | 'select' | 'relation';

function valueKind(subject: Subject): ValueKind {
  if ('builtin' in subject) {
    return subject.builtin === '@title' ? 'text' : subject.builtin === '@backlinks' ? 'number' : 'date';
  }
  return subject.field.kind === 'url' ? 'text' : subject.field.kind;
}

function findField(type: QueryType, name: string): QueryField | undefined {
  const wanted = name.toLowerCase();
  return type.fields.find((f) => f.name.toLowerCase() === wanted);
}

function findBuiltin(name: string): Builtin | undefined {
  const wanted = name.toLowerCase();
  return BUILTINS.find((b) => b === wanted);
}

/** The stored value a subject reads, or null. */
function readSubject(subject: Subject, obj: QueryObject): string | number | null {
  if ('builtin' in subject) {
    return subject.builtin === '@title' ? obj.title : subject.builtin === '@backlinks' ? obj.backlinks : obj.updatedDate;
  }
  return obj.properties[subject.field.name] ?? null;
}

/** The relation target a property names, or null when unset. */
function relationTarget(obj: QueryObject, field: QueryField, ctx: Pick<QueryContext, 'objectById'>): QueryObject | null {
  const id = obj.properties[field.name];
  return typeof id === 'string' ? (ctx.objectById(id) ?? null) : null;
}

/** A sort key's comparable value: text and relation titles as strings, select as option position. */
function sortValue(subject: Subject, obj: QueryObject, ctx: Pick<QueryContext, 'objectById'>): string | number | null {
  if ('field' in subject && subject.field.kind === 'relation') return relationTarget(obj, subject.field, ctx)?.title ?? null;
  const value = readSubject(subject, obj);
  if (value !== null && 'field' in subject && subject.field.kind === 'select') return (subject.field.options ?? []).indexOf(String(value));
  return value;
}

/** Compares two non-null sort values of one kind (Business rules: "Comparing values"). */
function compareSortValues(kind: ValueKind, a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const x = String(a);
  const y = String(b);
  return kind === 'date' ? (x < y ? -1 : x > y ? 1 : 0) : compareText(x, y);
}

// ---------------------------------------------------------------------------
// Sort and grouping

export type SortDirection = 'asc' | 'desc';
export type SortKey = { key: string; dir: SortDirection };

/** A sort key names a field of the type (any case), `@title`, `@backlinks` or `@updated`. */
function sortSubject(type: QueryType, key: string): Subject | undefined {
  const builtin = findBuiltin(key);
  if (builtin !== undefined) return { builtin };
  const field = findField(type, key);
  return field === undefined ? undefined : { field };
}

export function isSortKey(type: QueryType, key: string): boolean {
  return sortSubject(type, key) !== undefined;
}

/** Orders rows by up to three keys, nulls last either way, then title like text, then id. */
export function sortObjects(
  objs: QueryObject[],
  type: QueryType,
  sort: SortKey[],
  ctx: Pick<QueryContext, 'objectById'>,
): QueryObject[] {
  const keys = sort.flatMap((s) => {
    const subject = sortSubject(type, s.key);
    return subject === undefined ? [] : [{ subject, kind: valueKind(subject), sign: s.dir === 'desc' ? -1 : 1 }];
  });
  const rows = objs.map((obj) => ({ obj, values: keys.map((k) => sortValue(k.subject, obj, ctx)) }));
  rows.sort((a, b) => {
    for (let i = 0; i < keys.length; i++) {
      const x = a.values[i];
      const y = b.values[i];
      if (x === null || y === null) {
        if (x !== y) return x === null ? 1 : -1;
        continue;
      }
      const order = compareSortValues(keys[i].kind, x, y);
      if (order !== 0) return keys[i].sign * order;
    }
    return compareText(a.obj.title, b.obj.title) || compareIds(a.obj.id, b.obj.id);
  });
  return rows.map((r) => r.obj);
}

const GROUPABLE_KINDS: readonly FieldKind[] = ['select', 'relation', 'date', 'text'];
export const NO_VALUE_LABEL = 'No value';

/** The select, relation, date or text field of the type that `group_by` names, if any. */
export function groupField(type: QueryType, groupBy: string): QueryField | undefined {
  const field = findField(type, groupBy);
  return field !== undefined && GROUPABLE_KINDS.includes(field.kind) ? field : undefined;
}

export type QueryGroup = { key: string | null; label: string; rows: QueryObject[] };

/** Groups already-ordered rows by a field's value: by label like text, `No value` last, rows in order. */
export function groupObjects(
  rows: QueryObject[],
  field: QueryField,
  ctx: Pick<QueryContext, 'objectById'>,
): QueryGroup[] {
  const groups = new Map<string, QueryGroup>();
  const noValue: QueryGroup = { key: null, label: NO_VALUE_LABEL, rows: [] };
  for (const obj of rows) {
    const stored = obj.properties[field.name];
    const label = field.kind === 'relation' ? relationTarget(obj, field, ctx)?.title : stored;
    if (typeof stored !== 'string' || typeof label !== 'string') {
      noValue.rows.push(obj);
      continue;
    }
    const group = groups.get(stored) ?? { key: stored, label, rows: [] };
    group.rows.push(obj);
    groups.set(stored, group);
  }
  const ordered = [...groups.values()].sort((a, b) => compareText(a.label, b.label));
  return noValue.rows.length > 0 ? [...ordered, noValue] : ordered;
}

// ---------------------------------------------------------------------------
// Parsing and checking

export type ComparisonOp = '=' | '!=' | '~' | '<' | '<=' | '>' | '>=';

type Operand =
  | { kind: 'null' }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'date'; value: string }
  | { kind: 'today'; offsetDays: number };

/** A path: one subject, or a relation field followed by a subject of its target type. */
type Path = { via: QueryField | null; subject: Subject };

type Condition =
  | { kind: 'or' | 'and'; items: Condition[] }
  | { kind: 'not'; item: Condition }
  | { kind: 'cmp'; path: Path; op: ComparisonOp; operand: Operand };

/** A checked query; `condition` is null for empty text, which matches every object of the type. */
export type CompiledQuery = { condition: Condition | null };

export type QueryCheck = { ok: true; query: CompiledQuery } | { ok: false; message: string };

class QueryError extends Error {}

type TokenKind = 'end' | 'string' | 'number' | 'date' | 'word' | 'bracket' | 'at' | 'op' | 'symbol';
type Token = { kind: TokenKind; text: string; value: string; start: number; end: number };

const KEYWORDS = ['and', 'or', 'not', 'today', 'null'];
const OPS: readonly ComparisonOp[] = ['!=', '<=', '>=', '=', '~', '<', '>'];
const isComparisonOp = (text: string): text is ComparisonOp => OPS.some((op) => op === text);

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';
const isWordStart = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}_]/u.test(ch);
const isWordPart = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{Nd}_]/u.test(ch);

function isRealDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const OPERATORS_BY_KIND: Record<ValueKind, readonly ComparisonOp[]> = {
  text: ['=', '!=', '~'],
  number: ['=', '!=', '<', '<=', '>', '>='],
  date: ['=', '!=', '<', '<=', '>', '>='],
  select: ['=', '!='],
  relation: ['=', '!='],
};

/** A left-to-right, one-pass parser over the text's code points; throws the first error met. */
class Parser {
  private readonly chars: string[];
  private pos = 0;
  private readonly type: QueryType;
  private readonly typeById: (id: string) => QueryType | undefined;

  constructor(chars: string[], type: QueryType, typeById: (id: string) => QueryType | undefined) {
    this.chars = chars;
    this.type = type;
    this.typeById = typeById;
  }

  parse(): Condition {
    const condition = this.parseOr(0);
    const rest = this.peek();
    if (rest.kind !== 'end') this.unexpected(rest);
    return condition;
  }

  private fail(message: string, start: number): never {
    throw new QueryError(`${message} at column ${start + 1}.`);
  }

  private unexpected(token: Token): never {
    if (token.kind === 'end') this.fail('Unexpected end of query', this.chars.length);
    this.fail(`Unexpected ${token.text}`, token.start);
  }

  private skipSpace(): void {
    while (this.pos < this.chars.length && /\s/u.test(this.chars[this.pos])) this.pos++;
  }

  /** Reads the token at the cursor without consuming it. */
  private peek(): Token {
    this.skipSpace();
    return this.lex(this.pos);
  }

  private take(): Token {
    const token = this.peek();
    this.pos = token.end;
    return token;
  }

  private token(kind: TokenKind, start: number, end: number, value?: string): Token {
    const text = this.chars.slice(start, end).join('');
    return { kind, text, value: value ?? text, start, end };
  }

  private lex(start: number): Token {
    const c = this.chars;
    const ch = c[start];
    if (ch === undefined) return this.token('end', start, start);
    if (ch === '"') return this.lexString(start);
    if (ch === '[') {
      const close = c.indexOf(']', start + 1);
      if (close < 0) this.fail('Unexpected end of query', c.length);
      return this.token('bracket', start, close + 1, c.slice(start + 1, close).join(''));
    }
    if (ch === '@') {
      let end = start + 1;
      while (isWordPart(c[end])) end++;
      return this.token(end > start + 1 ? 'at' : 'symbol', start, end);
    }
    if (isWordStart(ch)) {
      let end = start + 1;
      while (isWordPart(c[end])) end++;
      return this.token('word', start, end);
    }
    if (isDigit(ch) || (ch === '-' && isDigit(c[start + 1]))) return this.lexNumberOrDate(start);
    const op = OPS.find((o) => Array.from(o).every((oc, i) => c[start + i] === oc));
    if (op !== undefined) return this.token('op', start, start + op.length);
    return this.token('symbol', start, start + 1);
  }

  private lexString(start: number): Token {
    const c = this.chars;
    let value = '';
    for (let i = start + 1; i < c.length; i++) {
      if (c[i] === '"') return this.token('string', start, i + 1, value);
      if (c[i] === '\\') {
        const next = c[i + 1];
        if (next === undefined) break;
        if (next !== '"' && next !== '\\') this.fail(`Unexpected \\${next}`, i);
        value += next;
        i++;
      } else value += c[i];
    }
    return this.fail('Unclosed string', start);
  }

  private lexNumberOrDate(start: number): Token {
    const c = this.chars;
    const dateText = c.slice(start, start + 10).join('');
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText) && !isDigit(c[start + 10])) {
      if (!isRealDate(dateText)) this.fail('Not a real date', start);
      return this.token('date', start, start + 10);
    }
    let end = start + 1;
    while (isDigit(c[end])) end++;
    if (c[end] === '.' && isDigit(c[end + 1])) {
      end += 2;
      while (isDigit(c[end])) end++;
    }
    return this.token('number', start, end);
  }

  private isKeyword(token: Token, keyword: string): boolean {
    return token.kind === 'word' && token.text.toLowerCase() === keyword;
  }

  private parseOr(depth: number): Condition {
    const items = [this.parseAnd(depth)];
    while (this.isKeyword(this.peek(), 'or')) {
      this.take();
      items.push(this.parseAnd(depth));
    }
    return items.length === 1 ? items[0] : { kind: 'or', items };
  }

  private parseAnd(depth: number): Condition {
    const items = [this.parseNot(depth)];
    while (this.isKeyword(this.peek(), 'and')) {
      this.take();
      items.push(this.parseNot(depth));
    }
    return items.length === 1 ? items[0] : { kind: 'and', items };
  }

  private parseNot(depth: number): Condition {
    const token = this.peek();
    const opensNot = this.isKeyword(token, 'not');
    if (opensNot || (token.kind === 'symbol' && token.text === '(')) {
      if (depth >= MAX_NESTING) this.fail('Too deeply nested', token.start);
      this.take();
      if (opensNot) return { kind: 'not', item: this.parseNot(depth + 1) };
      const inner = this.parseOr(depth + 1);
      const close = this.take();
      if (!(close.kind === 'symbol' && close.text === ')')) this.unexpected(close);
      return inner;
    }
    return this.parseComparison();
  }

  /** A name token resolved against a type: a field (any case), or a built-in when allowed. */
  private resolveName(token: Token, type: QueryType, builtins: readonly Builtin[]): Subject | undefined {
    if (token.kind === 'at') {
      const builtin = findBuiltin(token.text);
      return builtin !== undefined && builtins.includes(builtin) ? { builtin } : undefined;
    }
    const field = findField(type, token.value);
    return field === undefined ? undefined : { field };
  }

  private isName(token: Token): boolean {
    return token.kind === 'bracket' || token.kind === 'at' || (token.kind === 'word' && !KEYWORDS.includes(token.text.toLowerCase()));
  }

  private parsePath(): { path: Path; name: string } {
    const first = this.take();
    if (!this.isName(first)) this.unexpected(first);
    const firstSubject = this.resolveName(first, this.type, BUILTINS);
    if (firstSubject === undefined) this.fail(`Unknown field ${first.value}`, first.start);
    const dot = this.peek();
    if (!(dot.kind === 'symbol' && dot.text === '.')) return { path: { via: null, subject: firstSubject }, name: first.value };
    this.take();
    const second = this.take();
    if (!this.isName(second)) this.unexpected(second);
    const name = `${first.value}.${second.value}`;
    const via = 'field' in firstSubject && firstSubject.field.kind === 'relation' ? firstSubject.field : null;
    const targetTypeId = via?.targetTypeId ?? null;
    const target = targetTypeId === null ? undefined : this.typeById(targetTypeId);
    const subject = via === null || target === undefined ? undefined : this.resolveName(second, target, ['@title']);
    if (subject === undefined) this.fail(`Unknown field ${name}`, first.start);
    return { path: { via, subject }, name };
  }

  private parseComparison(): Condition {
    const { path, name } = this.parsePath();
    const kind = valueKind(path.subject);
    const opToken = this.take();
    const op = opToken.text;
    if (opToken.kind !== 'op' || !isComparisonOp(op)) return this.unexpected(opToken);
    // `=` and `!=` fit every left side, so a misfit is known before the value is read.
    if (!OPERATORS_BY_KIND[kind].includes(op)) this.fail(`${op} does not fit ${name}`, opToken.start);
    const valueToken = this.take();
    if (this.isKeyword(valueToken, 'null') && (op === '=' || op === '!=')) {
      return { kind: 'cmp', path, op, operand: { kind: 'null' } };
    }
    return { kind: 'cmp', path, op, operand: this.operand(kind, valueToken, path.subject, name) };
  }

  private operand(kind: ValueKind, token: Token, subject: Subject, name: string): Operand {
    if (kind === 'number' && token.kind === 'number') return { kind: 'number', value: Number(token.text) };
    if (kind === 'date' && token.kind === 'date') return { kind: 'date', value: token.text };
    if (kind === 'date' && this.isKeyword(token, 'today')) return { kind: 'today', offsetDays: this.todayOffset() };
    if ((kind === 'text' || kind === 'relation') && token.kind === 'string') return { kind: 'string', value: token.value };
    if (kind === 'select' && token.kind === 'string') {
      const options = 'field' in subject ? (subject.field.options ?? []) : [];
      const wanted = token.value.toLowerCase();
      if (!options.some((o) => o.toLowerCase() === wanted)) this.fail(`"${token.value}" is not an option of ${name}`, token.start);
      return { kind: 'string', value: token.value };
    }
    return this.unexpected(token);
  }

  /** The optional `+ Nd` or `- Nd` after `today`. */
  private todayOffset(): number {
    this.skipSpace();
    const sign = this.chars[this.pos];
    if (sign !== '+' && sign !== '-') return 0;
    this.pos++;
    this.skipSpace();
    let end = this.pos;
    while (isDigit(this.chars[end])) end++;
    if (end === this.pos || this.chars[end] !== 'd') this.unexpected(this.lex(this.pos));
    const days = Number(this.chars.slice(this.pos, end).join(''));
    this.pos = end + 1;
    return sign === '-' ? -days : days;
  }
}

/** Checks query text for one type; reports only the first error, with columns in characters. */
export function checkQuery(text: string, type: QueryType, ctx: Pick<QueryContext, 'typeById'>): QueryCheck {
  const chars = Array.from(text);
  if (chars.length > QUERY_TEXT_CAP) return { ok: false, message: `Use at most ${QUERY_TEXT_CAP} characters.` };
  if (text.trim() === '') return { ok: true, query: { condition: null } };
  try {
    return { ok: true, query: { condition: new Parser(chars, type, (id) => ctx.typeById(id)).parse() } };
  } catch (error) {
    if (error instanceof QueryError) return { ok: false, message: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Evaluation

function compareOrdered(op: ComparisonOp, order: number): boolean {
  switch (op) {
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    case '!=':
      return order !== 0;
    default:
      return order === 0;
  }
}

function evaluateComparison(cmp: { path: Path; op: ComparisonOp; operand: Operand }, obj: QueryObject, ctx: QueryContext): boolean {
  const holder = cmp.path.via === null ? obj : relationTarget(obj, cmp.path.via, ctx);
  const subject = cmp.path.subject;
  const kind = valueKind(subject);
  let value = holder === null ? null : readSubject(subject, holder);
  if (holder !== null && kind === 'relation' && 'field' in subject) value = relationTarget(holder, subject.field, ctx)?.title ?? null;
  const { op, operand } = cmp;
  if (operand.kind === 'null') return op === '=' ? value === null : value !== null;
  if (value === null) return false;
  if (operand.kind === 'number') return compareOrdered(op, Number(value) - operand.value);
  if (operand.kind === 'date' || operand.kind === 'today') {
    const date = operand.kind === 'date' ? operand.value : addDays(ctx.today, operand.offsetDays);
    const stored = String(value);
    return compareOrdered(op, stored < date ? -1 : stored > date ? 1 : 0);
  }
  const stored = String(value).toLowerCase();
  const wanted = operand.value.toLowerCase();
  return op === '~' ? stored.includes(wanted) : compareOrdered(op, stored === wanted ? 0 : 1);
}

function evaluate(condition: Condition, obj: QueryObject, ctx: QueryContext): boolean {
  switch (condition.kind) {
    case 'or':
      return condition.items.some((c) => evaluate(c, obj, ctx));
    case 'and':
      return condition.items.every((c) => evaluate(c, obj, ctx));
    case 'not':
      return !evaluate(condition.item, obj, ctx);
    case 'cmp':
      return evaluateComparison(condition, obj, ctx);
  }
}

/** Whether an object satisfies a checked query. */
export function matches(query: CompiledQuery, obj: QueryObject, ctx: QueryContext): boolean {
  return query.condition === null || evaluate(query.condition, obj, ctx);
}
