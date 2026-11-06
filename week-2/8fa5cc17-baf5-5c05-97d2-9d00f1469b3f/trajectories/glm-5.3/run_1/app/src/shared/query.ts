// The saved-query language: parser, checker and evaluator. A query selects
// objects of one type whose properties satisfy its text.

export type FieldKind = "text" | "number" | "date" | "url" | "select" | "relation";

export interface FieldDef {
  name: string;
  kind: FieldKind;
  required: boolean;
  options: string[] | null;
  target_type_id: string | null;
}

export interface QueryType {
  id: string;
  name: string;
  fields: FieldDef[];
}

export interface QueryObject {
  id: string;
  title: string;
  properties: Record<string, unknown>;
  backlinks: number;
  updated_at: string; // ISO-8601 UTC
  updated_date: string; // home-clock date of updated_at
}

export const QUERY_TEXT_CAP = 500;

// ---------------------------------------------------------------------------
// Lexer

type TokKind = "ident" | "at" | "string" | "number" | "date" | "lparen" | "rparen" | "op" | "kw" | "today" | "null" | "bad";
interface Tok {
  kind: TokKind;
  text: string;
  raw: string; // as written in the query
  col: number; // 1-based code point column
}

const KEYWORDS = ["AND", "OR", "NOT"];

function lex(text: string): { tokens: Tok[]; error: { message: string; col: number } | null } {
  const tokens: Tok[] = [];
  let i = 0; // index in UTF-16 units
  const cp = (idx: number): number => {
    // convert utf-16 index to code point count
    let n = 0;
    for (let j = 0; j < idx && j < text.length; j += 1) {
      const code = text.charCodeAt(j);
      if (code >= 0xd800 && code <= 0xdbff && j + 1 < idx) j += 1;
      n += 1;
    }
    return n + 1;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lparen", text: c, raw: c, col: cp(i) });
      i += 1;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen", text: c, raw: c, col: cp(i) });
      i += 1;
      continue;
    }
    if (c === "[") {
      const end = text.indexOf("]", i);
      if (end === -1) {
        tokens.push({ kind: "bad", text: "[", raw: "[", col: cp(i) });
        i += 1;
        continue;
      }
      const inner = text.slice(i + 1, end);
      if (inner.includes("[")) {
        tokens.push({ kind: "bad", text: "[", raw: "[", col: cp(i) });
        i += 1;
        continue;
      }
      tokens.push({ kind: "ident", text: inner, raw: inner, col: cp(i) });
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < text.length) {
        if (text[j] === "\\") {
          if (j + 1 < text.length && (text[j + 1] === '"' || text[j + 1] === "\\")) {
            value += text[j + 1];
            j += 2;
            continue;
          }
          value += "\\";
          j += 1;
          continue;
        }
        if (text[j] === '"') {
          closed = true;
          break;
        }
        value += text[j];
        j += 1;
      }
      if (!closed) return { tokens: [], error: { message: `Unclosed string at column ${cp(i)}.`, col: cp(i) } };
      tokens.push({ kind: "string", text: value, raw: "\"" + value + "\"", col: cp(i) });
      i = j + 1;
      continue;
    }
    if (c === "@") {
      const m = /^@(title|backlinks|updated)/.exec(text.slice(i));
      if (m) {
        tokens.push({ kind: "at", text: m[0], raw: m[0], col: cp(i) });
        i += m[0].length;
        continue;
      }
      tokens.push({ kind: "bad", text: "@", raw: "@", col: cp(i) });
      i += 1;
      continue;
    }
    const dateM = /^\d{4}-\d{2}-\d{2}/.exec(text.slice(i));
    if (dateM) {
      tokens.push({ kind: "date", text: dateM[0], raw: dateM[0], col: cp(i) });
      i += dateM[0].length;
      continue;
    }
    const numM = /^-?\d+(\.\d+)?/.exec(text.slice(i));
    if (numM) {
      tokens.push({ kind: "number", text: numM[0], raw: numM[0], col: cp(i) });
      i += numM[0].length;
      continue;
    }
    const opM = /^(!=|<=|>=|=|~|<|>)/.exec(text.slice(i));
    if (opM) {
      tokens.push({ kind: "op", text: opM[0], raw: opM[0], col: cp(i) });
      i += opM[0].length;
      continue;
    }
    const identM = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    if (identM) {
      if (KEYWORDS.includes(identM[0].toUpperCase())) {
        tokens.push({ kind: "kw", text: identM[0].toUpperCase(), raw: identM[0], col: cp(i) });
      } else if (identM[0].toLowerCase() === "today") {
        const rest = text.slice(i);
        const todayM = /^today(\s*([+-])\s*(\d+)\s*d)?/i.exec(rest);
        if (todayM) {
          tokens.push({ kind: "today", text: todayM[0], raw: todayM[0], col: cp(i) });
          i += todayM[0].length;
          continue;
        }
        tokens.push({ kind: "kw", text: identM[0], raw: identM[0], col: cp(i) });
      } else if (identM[0].toLowerCase() === "null") {
        tokens.push({ kind: "null", text: identM[0], raw: identM[0], col: cp(i) });
      } else {
        tokens.push({ kind: "ident", text: identM[0], raw: identM[0], col: cp(i) });
      }
      i += identM[0].length;
      continue;
    }
    tokens.push({ kind: "bad", text: c, raw: c, col: cp(i) });
    i += 1;
  }
  return { tokens, error: null };
}

// ---------------------------------------------------------------------------
// AST

export type Node =
  | { t: "or"; parts: Node[] }
  | { t: "and"; parts: Node[] }
  | { t: "not"; inner: Node }
  | { t: "cmp"; path: Path; op: string; value: Value; opCol: number; valueCol: number };

export type Path =
  | { t: "field"; name: string; field: FieldDef }
  | { t: "relpath"; rel: FieldDef; name: string; field: FieldDef | "@title" };

export type Value =
  | { t: "string"; value: string }
  | { t: "number"; value: number }
  | { t: "date"; value: string }
  | { t: "today"; value: string } // resolved date
  | { t: "null" };

export interface ParseCtx {
  tokens: Tok[];
  pos: number;
  type: QueryType;
  today: string; // home-clock date
  dateAdd: (date: string, days: number) => string;
  depth: number;
  endCol: number;
  relationTarget: (field: FieldDef) => QueryType | null;
}

export interface ParseError {
  message: string;
  col: number;
}

function findField(type: QueryType, name: string): FieldDef | null {
  for (const f of type.fields) {
    if (f.name.toLowerCase() === name.toLowerCase()) return f;
  }
  return null;
}

function peek(ctx: ParseCtx): Tok | null {
  return ctx.pos < ctx.tokens.length ? ctx.tokens[ctx.pos] : null;
}

function next(ctx: ParseCtx): Tok | null {
  const t = peek(ctx);
  if (t !== null) ctx.pos += 1;
  return t;
}

function err(token: Tok): ParseError {
  if (token.kind === "string") return { message: `Unexpected ${token.raw} at column ${token.col}.`, col: token.col };
  return { message: `Unexpected ${token.raw} at column ${token.col}.`, col: token.col };
}

function parseOr(ctx: ParseCtx): Node | ParseError {
  const first = parseAnd(ctx);
  if ("message" in first) return first;
  const parts = [first];
  for (;;) {
    const save = ctx.pos;
    const t = next(ctx);
    if (t !== null && t.kind === "kw" && t.text === "OR") {
      const part = parseAnd(ctx);
      if ("message" in part) return part;
      parts.push(part);
      continue;
    }
    ctx.pos = save;
    break;
  }
  return parts.length === 1 ? parts[0] : { t: "or", parts };
}

function parseAnd(ctx: ParseCtx): Node | ParseError {
  const first = parseNot(ctx);
  if ("message" in first) return first;
  const parts = [first];
  for (;;) {
    const save = ctx.pos;
    const t = next(ctx);
    if (t !== null && t.kind === "kw" && t.text === "AND") {
      const part = parseNot(ctx);
      if ("message" in part) return part;
      parts.push(part);
      continue;
    }
    ctx.pos = save;
    break;
  }
  return parts.length === 1 ? parts[0] : { t: "and", parts };
}

function parseNot(ctx: ParseCtx): Node | ParseError {
  const t = peek(ctx);
  if (t !== null && t.kind === "kw" && t.text === "NOT") {
    ctx.pos += 1;
    if (ctx.depth + 1 > 8) return { message: `Too deeply nested at column ${t.col}.`, col: t.col };
    ctx.depth += 1;
    const inner = parseNot(ctx);
    ctx.depth -= 1;
    if ("message" in inner) return inner;
    return { t: "not", inner };
  }
  if (t !== null && t.kind === "lparen") {
    ctx.pos += 1;
    if (ctx.depth + 1 > 8) return { message: `Too deeply nested at column ${t.col}.`, col: t.col };
    ctx.depth += 1;
    const inner = parseOr(ctx);
    ctx.depth -= 1;
    if ("message" in inner) return inner;
    const r = next(ctx);
    if (r === null) return { message: `Unexpected end of query at column ${ctx.endCol}.`, col: ctx.endCol };
    if (r.kind !== "rparen") return err(r);
    return inner;
  }
  return parseCmp(ctx);
}

function pathKind(path: Path): FieldKind {
  if (path.t === "relpath") {
    return path.field === "@title" ? "text" : path.field.kind;
  }
  const name = path.field.name;
  if (name === "@title") return "text";
  if (name === "@backlinks") return "number";
  if (name === "@updated") return "date";
  return path.field.kind;
}

function pathLabel(path: Path): string {
  return path.t === "relpath" ? path.name : path.field.name;
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const daysInMonth = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= daysInMonth[mo - 1];
}

function parseCmp(ctx: ParseCtx): Node | ParseError {
  const t = peek(ctx);
  if (t === null) return { message: `Unexpected end of query at column ${ctx.endCol}.`, col: ctx.endCol };
  // path: @title / @backlinks / @updated, a field name, or a relation path
  let path: Path;
  if (t.kind === "at") {
    const key = t.text.slice(1);
    const kind: FieldKind = key === "title" ? "text" : key === "backlinks" ? "number" : "date";
    path = { t: "field", name: t.text, field: { name: t.text, kind, required: false, options: null, target_type_id: null } };
    ctx.pos += 1;
  } else if (t.kind === "ident") {
    const f = findField(ctx.type, t.text);
    if (f === null) return { message: `Unknown field ${t.text} at column ${t.col}.`, col: t.col };
    path = { t: "field", name: t.text, field: f };
    ctx.pos += 1;
    const dot = peek(ctx);
    if (dot !== null && dot.kind === "bad" && dot.text === ".") {
      ctx.pos += 1;
      const second = peek(ctx);
      if (second === null) return { message: `Unexpected end of query at column ${ctx.endCol}.`, col: ctx.endCol };
      if (second.kind !== "ident" && second.kind !== "at") return err(second);
      if (f.kind !== "relation") {
        return { message: `Unexpected ${second.text} at column ${second.col}.`, col: second.col };
      }
      let inner: FieldDef | "@title";
      if (second.kind === "at") {
        if (second.text !== "@title") return err(second);
        inner = "@title";
      } else {
        const target = ctx.relationTarget(f);
        if (target === null) return err(second);
        const f2 = findField(target, second.text);
        if (f2 === null) return { message: `Unknown field ${f.name}.${second.text} at column ${second.col}.`, col: second.col };
        inner = f2;
      }
      ctx.pos += 1;
      path = { t: "relpath", rel: f, name: `${f.name}.${second.text}`, field: inner };
    }
  } else {
    return err(t);
  }
  // operator, checked against the left side before the value is read
  const opTok = peek(ctx);
  if (opTok === null) return { message: `Unexpected end of query at column ${ctx.endCol}.`, col: ctx.endCol };
  if (opTok.kind !== "op") return err(opTok);
  ctx.pos += 1;
  const kind = pathKind(path);
  const label = pathLabel(path);
  if (opTok.text === "~") {
    if (kind !== "text" && kind !== "url" && !(path.t === "relpath" && path.field === "@title")) {
      return { message: `${opTok.text} does not fit ${label} at column ${opTok.col}.`, col: opTok.col };
    }
  }
  if (opTok.text === "<" || opTok.text === "<=" || opTok.text === ">" || opTok.text === ">=") {
    if (kind !== "number" && kind !== "date") {
      return { message: `${opTok.text} does not fit ${label} at column ${opTok.col}.`, col: opTok.col };
    }
  }
  // value
  const valTok = peek(ctx);
  if (valTok === null) return { message: `Unexpected end of query at column ${ctx.endCol}.`, col: ctx.endCol };
  let value: Value;
  if (valTok.kind === "null") {
    value = { t: "null" };
    ctx.pos += 1;
  } else if (valTok.kind === "string") {
    value = { t: "string", value: valTok.text };
    ctx.pos += 1;
  } else if (valTok.kind === "number") {
    value = { t: "number", value: Number(valTok.text) };
    ctx.pos += 1;
  } else if (valTok.kind === "date") {
    if (!isRealDate(valTok.text)) return { message: `Not a real date at column ${valTok.col}.`, col: valTok.col };
    value = { t: "date", value: valTok.text };
    ctx.pos += 1;
  } else if (valTok.kind === "today") {
    const m = /([+-])\s*(\d+)\s*d$/i.exec(valTok.text);
    let date = ctx.today;
    if (m) date = ctx.dateAdd(date, (m[1] === "-" ? -1 : 1) * Number(m[2]));
    value = { t: "today", value: date };
    ctx.pos += 1;
  } else {
    return err(valTok);
  }
  // value kind against the left side
  if (value.t !== "null") {
    if (opTok.text === "=" || opTok.text === "!=") {
      if (kind === "text" || kind === "url" || kind === "relation") {
        if (value.t !== "string") return err(valTok);
      } else if (kind === "number") {
        if (value.t !== "number") return err(valTok);
      } else if (kind === "date") {
        if (value.t !== "date" && value.t !== "today") return err(valTok);
      } else if (kind === "select") {
        if (value.t !== "string") return err(valTok);
        const opts = path.t === "field" ? (path.field.options ?? []) : [];
        if (!opts.some((o) => o.toLowerCase() === (value as { value: string }).value.toLowerCase())) {
          return { message: `"${(value as { value: string }).value}" is not an option of ${label} at column ${valTok.col}.`, col: valTok.col };
        }
      }
    } else {
      if (kind === "number" && value.t !== "number") return err(valTok);
      if (kind === "date" && value.t !== "date" && value.t !== "today") return err(valTok);
    }
  }
  return { t: "cmp", path, op: opTok.text, value, opCol: opTok.col, valueCol: valTok.col };
}

export interface ParseResult {
  ast: Node | null;
  error: ParseError | null;
}

export interface ParseOptions {
  type: QueryType;
  today: string; // home-clock date YYYY-MM-DD
  relationTarget?: (field: FieldDef) => QueryType | null;
}

/** Parse and check a query. Returns the AST, or the first error. */
export function parseQuery(text: string, opts: ParseOptions): ParseResult {
  if (text.length > QUERY_TEXT_CAP) {
    return { ast: null, error: { message: "Use at most 500 characters.", col: 0 } };
  }
  const trimmedLeading = text;
  const { tokens, error } = lex(trimmedLeading);
  if (error !== null) return { ast: null, error };
  const endCol = codePoints(text) + 1;
  const ctx: ParseCtx = {
    tokens,
    pos: 0,
    type: opts.type,
    today: opts.today,
    dateAdd: addDays,
    depth: 0,
    endCol,
    relationTarget: opts.relationTarget ?? (() => null),
  };
  if (tokens.length === 0) return { ast: null, error: null }; // matches everything
  const ast = parseOr(ctx);
  if ("message" in ast) return { ast: null, error: ast };
  if (ctx.pos < tokens.length) {
    const t = tokens[ctx.pos];
    return { ast: null, error: err(t) };
  }
  return { ast, error: null };
}

function codePoints(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) i += 1;
    n += 1;
  }
  return n;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map((x) => Number(x));
  const ms = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(ms);
  return isoDate(dt);
}

export function isoDate(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Value comparison used for sorting and grouping. The single home.

export type SortKind = "text" | "url" | "select" | "relation" | "number" | "date" | "id";

export interface SortContext {
  titleOf: (objectId: unknown) => string | null;
}

/** Compare two values of a kind; nulls come last for every key. */
export function compareByKind(kind: SortKind, a: unknown, b: unknown, ctx: SortContext, options?: string[] | null): number {
  if (a === null || a === undefined) {
    if (b === null || b === undefined) return 0;
    return 1; // nulls last
  }
  if (b === null || b === undefined) return -1;
  switch (kind) {
    case "text":
    case "url":
      return cmpLower(String(a), String(b));
    case "select": {
      const opts = options ?? [];
      const ai = opts.indexOf(String(a));
      const bi = opts.indexOf(String(b));
      if (ai !== bi) return ai < bi ? -1 : 1;
      return cmpLower(String(a), String(b));
    }
    case "relation": {
      const at = ctx.titleOf(a);
      const bt = ctx.titleOf(b);
      return cmpLower(at ?? "", bt ?? "");
    }
    case "number":
      return Number(a) < Number(b) ? -1 : Number(a) > Number(b) ? 1 : 0;
    case "date":
      return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    case "id":
      return cmpLower(String(a), String(b));
  }
}

function cmpLower(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return 0;
  if (al.startsWith(bl)) return 1;
  if (bl.startsWith(al)) return -1;
  return al < bl ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Evaluation

export interface EvalCtx {
  today: string;
  resolveRelation: (objectId: unknown) => QueryObject | null;
}

function cmpText(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return 0;
  if (al.startsWith(bl)) return 1;
  if (bl.startsWith(al)) return -1;
  return al < bl ? -1 : 1;
}

function evalNode(node: Node, obj: QueryObject, ctx: EvalCtx): boolean {
  if (node.t === "or") return node.parts.some((p) => evalNode(p, obj, ctx));
  if (node.t === "and") return node.parts.every((p) => evalNode(p, obj, ctx));
  if (node.t === "not") return !evalNode(node.inner, obj, ctx);
  // cmp
  let left: unknown;
  let kind: FieldKind | "title";
  if (node.path.t === "field") {
    const name = node.path.field.name;
    if (name === "@title") {
      left = obj.title;
      kind = "text";
    } else if (name === "@backlinks") {
      left = obj.backlinks;
      kind = "number";
    } else if (name === "@updated") {
      left = obj.updated_date;
      kind = "date";
    } else {
      left = obj.properties[name];
      kind = node.path.field.kind;
    }
  } else {
    const innerKind: FieldKind | "title" = node.path.field === "@title" ? "text" : node.path.field.kind;
    kind = innerKind;
    const target = ctx.resolveRelation(obj.properties[node.path.rel.name]);
    if (target === null) {
      left = null;
    } else if (node.path.field === "@title") {
      left = target.title;
    } else {
      left = target.properties[node.path.field.name];
    }
  }
  if (node.value.t === "null") {
    return node.op === "=" ? left === null || left === undefined : left !== null && left !== undefined;
  }
  if (left === null || left === undefined) return false;
  const v = node.value;
  switch (kind as FieldKind) {
    case "text":
    case "url": {
      if (v.t !== "string") return false;
      const l = String(left);
      if (node.op === "=") return l.toLowerCase() === v.value.toLowerCase();
      if (node.op === "!=") return l.toLowerCase() !== v.value.toLowerCase();
      return l.toLowerCase().includes(v.value.toLowerCase());
    }
    case "select": {
      if (v.t !== "string") return false;
      if (node.op === "=") return String(left).toLowerCase() === v.value.toLowerCase();
      return String(left).toLowerCase() !== v.value.toLowerCase();
    }
    case "relation": {
      const target = ctx.resolveRelation(left);
      if (target === null) return false;
      if (v.t !== "string") return false;
      if (node.op === "=") return target.title.toLowerCase() === v.value.toLowerCase();
      return target.title.toLowerCase() !== v.value.toLowerCase();
    }
    case "number": {
      if (v.t !== "number" || typeof left !== "number") return false;
      switch (node.op) {
        case "=": return left === v.value;
        case "!=": return left !== v.value;
        case "<": return left < v.value;
        case "<=": return left <= v.value;
        case ">": return left > v.value;
        case ">=": return left >= v.value;
        default: return false;
      }
    }
    case "date": {
      const l = String(left);
      const r = v.t === "today" ? v.value : v.t === "date" ? v.value : null;
      if (r === null) return false;
      if (node.op === "=") return l === r;
      if (node.op === "!=") return l !== r;
      if (node.op === "<") return l < r;
      if (node.op === "<=") return l <= r;
      if (node.op === ">") return l > r;
      if (node.op === ">=") return l >= r;
      return false;
    }
    default:
      return false;
  }
}

/** Does the object satisfy the query? An empty query matches everything. */
export function evalQuery(ast: Node | null, obj: QueryObject, ctx: EvalCtx): boolean {
  if (ast === null) return true;
  return evalNode(ast, obj, ctx);
}
