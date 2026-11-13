import type { FieldType } from "./types";
import { analyze, analyzerFor, type Token } from "./analyze";
import { isIsoDate } from "./util";

/**
 * Spoor Query AST (rule F). Leaves carry the 1-based position of the field name they started
 * at, for error reporting.
 */
export type Node =
  | { kind: "term"; field: string | null; value: string; quoted: boolean; pos: number }
  | { kind: "phrase"; field: string | null; value: string; pos: number }
  | { kind: "wildcard"; field: string | null; pattern: string; pos: number }
  | { kind: "exists"; field: string; pos: number }
  | { kind: "range"; field: string; op: ">" | ">=" | "<" | "<="; value: string | number; pos: number }
  | { kind: "values"; field: string; values: string[]; pos: number }
  | { kind: "scope"; field: string; child: Node; pos: number }
  | { kind: "and"; children: Node[] }
  | { kind: "or"; children: Node[] }
  | { kind: "not"; child: Node };

export class QueryError extends Error {
  constructor(
    public code: string,
    public text: string,
    public position: number,
  ) {
    super(text);
  }
}

export interface ParseCtx {
  /** Field types over the generations a search covers. */
  fieldTypes: Map<string, FieldType>;
  nowMs: number;
}

const UNITS: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
const RELATIVE_RE = /^now(?:-(\d+)([smhdw]))?$/;

/** A relative date as an ISO string, or undefined when the text is not one. */
export function relativeDate(text: string, nowMs: number): string | undefined {
  const m = RELATIVE_RE.exec(text);
  if (!m) return undefined;
  if (!m[1]) return new Date(nowMs).toISOString();
  return new Date(nowMs - Number(m[1]) * UNITS[m[2]]).toISOString();
}

const META_FIELDS = new Set(["_id", "@timestamp"]);

export function parseQuery(q: string, ctx: ParseCtx): Node {
  const p = new Scanner(q, ctx);
  const node = p.parseOr();
  p.skipSpaces();
  if (!p.atEnd()) {
    throw err(`Expected AND or OR at position ${p.i + 1}.`, p.i + 1);
  }
  return node;
}

class Scanner {
  i = 0;
  constructor(
    public text: string,
    public ctx: ParseCtx,
  ) {}
  atEnd(): boolean {
    return this.i >= this.text.length;
  }
  peek(): string {
    return this.text[this.i] ?? "";
  }
  skipSpaces(): void {
    while (this.i < this.text.length && /\s/.test(this.text[this.i])) this.i += 1;
  }
  matchWord(word: string): boolean {
    this.skipSpaces();
    if (!this.text.startsWith(word, this.i)) return false;
    const ch = this.text[this.i + word.length];
    if (ch === undefined || /[\s():"><{}]/.test(ch)) {
      this.i += word.length;
      return true;
    }
    return false;
  }

  parseOr(): Node {
    const children: Node[] = [this.parseAnd()];
    while (this.matchWord("OR")) children.push(this.parseAnd());
    return children.length === 1 ? children[0] : { kind: "or", children };
  }

  parseAnd(): Node {
    const children: Node[] = [this.parseUnary()];
    while (this.matchWord("AND")) children.push(this.parseUnary());
    return children.length === 1 ? children[0] : { kind: "and", children };
  }

  parseUnary(): Node {
    if (this.matchWord("NOT")) return { kind: "not", child: this.parseUnary() };
    return this.parsePrimary();
  }

  parsePrimary(): Node {
    this.skipSpaces();
    if (this.atEnd()) {
      throw err(`Expected a value at position ${this.i + 1}.`, this.i + 1);
    }
    const c = this.peek();
    if (c === "(") {
      const open = this.i;
      this.i += 1;
      const node = this.parseOr();
      this.skipSpaces();
      if (this.peek() !== ")") {
        throw err(`Unclosed parenthesis at position ${open + 1}.`, open + 1);
      }
      this.i += 1;
      return node;
    }
    if (c === ")" || c === "}") {
      throw err(`Expected a value at position ${this.i + 1}.`, this.i + 1);
    }
    if (c === '"') {
      const open = this.i;
      const value = this.readQuoted();
      return { kind: "phrase", field: null, value, pos: open + 1 };
    }
    const start = this.i;
    const word = this.readBare();
    if (word === "") {
      throw err(`Expected a value at position ${this.i + 1}.`, this.i + 1);
    }
    const op = this.readOp();
    if (op === null) {
      if (word.includes("*")) {
        return { kind: "wildcard", field: null, pattern: word, pos: start + 1 };
      }
      return { kind: "term", field: null, value: word, quoted: false, pos: start + 1 };
    }
    const field = word;
    const type = this.ctx.fieldTypes.get(field);
    if (type === undefined && !META_FIELDS.has(field)) {
      throw err(`Unknown field ${field} at position ${start + 1}.`, start + 1);
    }
    if (op === "{") {
      const open = this.i - 1;
      const child = this.parseOr();
      this.skipSpaces();
      if (this.peek() !== "}") {
        throw err(`Unclosed parenthesis at position ${open + 1}.`, open + 1);
      }
      this.i += 1;
      return { kind: "scope", field, child, pos: start + 1 };
    }
    if (op === ":") return this.parseColon(field, type, start);
    return this.parseRange(field, type, op as ">" | ">=" | "<" | "<=", start);
  }

  parseColon(field: string, type: FieldType | undefined, start: number): Node {
    this.skipSpaces();
    if (this.atEnd()) {
      throw err(`Expected a value at position ${this.text.length + 1}.`, this.text.length + 1);
    }
    if (this.peek() === "*" && endsValue(this.text, this.i + 1)) {
      this.i += 1;
      return { kind: "exists", field, pos: start + 1 };
    }
    if (this.peek() === "(") return this.parseValues(field, start);
    if (this.peek() === '"') {
      const value = this.readQuoted();
      if (type === "text" || (type === undefined && !META_FIELDS.has(field))) {
        return { kind: "phrase", field, value, pos: start + 1 };
      }
      return { kind: "term", field, value, quoted: true, pos: start + 1 };
    }
    if (!startsValue(this.peek())) {
      throw err(`Expected a value at position ${this.i + 1}.`, this.i + 1);
    }
    const vStart = this.i;
    const value = this.readBare();
    if (value.includes("*")) {
      if (type === "number" || type === "date" || type === "boolean") {
        const starAt = vStart + value.indexOf("*");
        throw err(
          `Wildcard not allowed on ${type} field ${field} at position ${starAt + 1}.`,
          starAt + 1,
        );
      }
      return { kind: "wildcard", field, pattern: value, pos: start + 1 };
    }
    return { kind: "term", field, value, quoted: false, pos: start + 1 };
  }

  parseRange(
    field: string,
    type: FieldType | undefined,
    op: ">" | ">=" | "<" | "<=",
    start: number,
  ): Node {
    const effective = type ?? (META_FIELDS.has(field) ? "date" : "text");
    if (effective !== "number" && effective !== "date") {
      const opPos = this.i - 1;
      throw err(`Range not allowed on ${effective} field ${field} at position ${opPos + 1}.`, opPos + 1);
    }
    this.skipSpaces();
    if (this.atEnd()) {
      throw err(`Expected a value at position ${this.text.length + 1}.`, this.text.length + 1);
    }
    if (!startsValue(this.peek())) {
      throw err(`Expected a value at position ${this.i + 1}.`, this.i + 1);
    }
    const vStart = this.i;
    const vText = this.peek() === '"' ? this.readQuoted() : this.readBare();
    if (effective === "number") {
      const num = Number(vText);
      if (isNaN(num)) {
        throw err(`Expected a number at position ${vStart + 1}.`, vStart + 1);
      }
      return { kind: "range", field, op, value: num, pos: start + 1 };
    }
    const rel = relativeDate(vText, this.ctx.nowMs);
    if (rel !== undefined) return { kind: "range", field, op, value: rel, pos: start + 1 };
    if (isIsoDate(vText)) return { kind: "range", field, op, value: vText, pos: start + 1 };
    throw err(`Expected a value at position ${vStart + 1}.`, vStart + 1);
  }

  parseValues(field: string, start: number): Node {
    const open = this.i;
    this.i += 1;
    const values: string[] = [];
    for (;;) {
      this.skipSpaces();
      if (this.atEnd()) {
        throw err(`Unclosed parenthesis at position ${open + 1}.`, open + 1);
      }
      if (this.peek() === ")") {
        this.i += 1;
        break;
      }
      if (this.peek() === '"') {
        values.push(this.readQuoted());
      } else {
        const raw = this.readBare();
        if (raw === "") {
          throw err(`Expected a value at position ${this.i + 1}.`, this.i + 1);
        }
        values.push(raw);
      }
      this.skipSpaces();
      if (this.peek() === ",") {
        this.i += 1;
        continue;
      }
      const save = this.i;
      if (this.matchWord("OR")) continue;
      this.i = save;
      this.skipSpaces();
      if (this.peek() === ")") {
        this.i += 1;
        break;
      }
      if (this.atEnd()) {
        throw err(`Unclosed parenthesis at position ${open + 1}.`, open + 1);
      }
      throw err(`Expected AND or OR at position ${this.i + 1}.`, this.i + 1);
    }
    return { kind: "values", field, values, pos: start + 1 };
  }

  /** Read a bare word: stops at whitespace and structural characters, resolving escapes. */
  readBare(): string {
    let out = "";
    while (this.i < this.text.length) {
      const ch = this.text[this.i];
      if (ch === "\\" && this.i + 1 < this.text.length && /[:(){}"*\\]/.test(this.text[this.i + 1])) {
        out += this.text[this.i + 1];
        this.i += 2;
        continue;
      }
      if (/[\s():"><{}]/.test(ch)) break;
      out += ch;
      this.i += 1;
    }
    return out;
  }

  readQuoted(): string {
    const open = this.i;
    this.i += 1;
    let out = "";
    while (this.i < this.text.length) {
      const ch = this.text[this.i];
      if (ch === "\\" && this.i + 1 < this.text.length && /["\\]/.test(this.text[this.i + 1])) {
        out += this.text[this.i + 1];
        this.i += 2;
        continue;
      }
      if (ch === '"') {
        this.i += 1;
        return out;
      }
      out += ch;
      this.i += 1;
    }
    throw err(`Unclosed quote at position ${open + 1}.`, open + 1);
  }

  readOp(): string | null {
    const two = this.text.slice(this.i, this.i + 2);
    if (two === ">=" || two === "<=") {
      this.i += 2;
      return two;
    }
    const c = this.peek();
    if (c === ">" || c === "<" || c === ":" || c === "{") {
      this.i += 1;
      return c;
    }
    return null;
  }
}

function startsValue(c: string): boolean {
  return c !== ")" && c !== "}" && c !== "";
}

function endsValue(text: string, i: number): boolean {
  const ch = text[i];
  return ch === undefined || /[\s)]/.test(ch);
}

function err(text: string, position: number): QueryError {
  return new QueryError("query_syntax", text, position);
}

/** Nesting depth (rule F limit 2): the deepest count of open ( and { around any character. */
export function queryDepth(q: string): number {
  let depth = 0;
  let max = 0;
  for (const c of q) {
    if (c === "(" || c === "{") {
      depth += 1;
      if (depth > max) max = depth;
    } else if (c === ")" || c === "}") {
      depth -= 1;
    }
  }
  return max;
}

/** Every leaf not under a NOT, in order. */
export function collectLeaves(node: Node, underNot = false): Node[] {
  switch (node.kind) {
    case "and":
    case "or":
      return node.children.flatMap((c) => collectLeaves(c, underNot));
    case "not":
      return collectLeaves(node.child, true);
    case "scope":
      return collectLeaves(node.child, underNot);
    default:
      return underNot ? [] : [node];
  }
}

/** The tokens a term or phrase leaf looks up. */
export function leafTokens(field: string | null, value: string, fieldType: FieldType | undefined): Token[] {
  if (field !== null && fieldType === "keyword") {
    return [{ token: value, position: 0, start: 0, end: value.length }];
  }
  return analyze("standard", value);
}

export function analyzerOfField(fieldType: FieldType | undefined): string {
  return analyzerFor(fieldType ?? "text");
}
